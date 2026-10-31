import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { SmsService } from '../auth/sms.service';
import { AiReviewSettings } from './ai-review.settings';
import { AvalaiClient, AvalaiRetryable, DocCandidate } from './avalai.client';

/** File types the model can read; anything else (Word) is left to the کارشناس. */
const READABLE = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const LOCK_KEY = 74_201_101; // pg advisory lock: one process claims jobs at a time (exact global cap)
const STALE_MS = 5 * 60_000; // a PROCESSING job older than this was cut off by a restart — run it again
const QUIET_MS = 60_000; // SMS once a case has had no new check for this long (the user may still be uploading)
export const LINK_TTL_DAYS = 7;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Public web address for links in SMS: PUBLIC_WEB_URL, else PUBLIC_API_BASE without /api/v1. */
export function webBase(): string {
  const w = process.env.PUBLIC_WEB_URL?.trim() || (process.env.PUBLIC_API_BASE ?? '').replace(/\/api\/v\d+\/?$/, '');
  return w.replace(/\/+$/, '');
}

/**
 * «بررسی هوشمند مدارک» queue. Each uploaded file becomes an AiReviewJob row; this worker checks them
 * with the AI model and records a verdict on the Document. At most `maxConcurrency` calls run at once
 * across every API process; on a rate limit the cap halves and the queue pauses, then it climbs back
 * one step per round of successes. When all of a case's files are checked (and the uploader has gone
 * quiet), the uploader gets ONE SMS: either «sent to the کارشناس», or a one-tap link to re-upload the
 * refused documents.
 */
@Injectable()
export class AiReviewQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiReviewQueue.name);
  private timers: NodeJS.Timeout[] = [];
  private running = 0;
  private limit = 0; // adaptive cap (0 = not yet known)
  private wins = 0;
  private pausedUntil = 0;
  private pumping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: FieldCryptoService,
    private readonly sms: SmsService,
    private readonly settings: AiReviewSettings,
    private readonly avalai: AvalaiClient,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => this.pump().catch((e) => this.logger.error(`AI queue: ${String(e)}`)), 3_000));
    this.timers.push(setInterval(() => this.notifySweep().catch((e) => this.logger.error(`AI SMS sweep: ${String(e)}`)), 30_000));
  }
  onModuleDestroy() { this.timers.forEach(clearInterval); }

  /** Queue one uploaded file. `notifyPhone` (plain) gets the result SMS. */
  async enqueue(documentId: string, claimId: string, notifyPhone: string | null) {
    const db = this.prisma.unscoped();
    await db.document.update({ where: { id: documentId }, data: { aiStatus: 'QUEUED' } });
    await db.aiReviewJob.create({ data: { documentId, claimId, notifyPhone: notifyPhone ? this.crypto.encrypt(notifyPhone) : null } });
    setImmediate(() => this.pump().catch(() => undefined));
  }

  /** Queue size for the super-admin page. */
  async stats() {
    const rows = await this.prisma.unscoped().aiReviewJob.groupBy({ by: ['status'], _count: true, where: { OR: [{ status: { not: 'DONE' } }, { finishedAt: { gte: new Date(Date.now() - 86_400_000) } }] } });
    const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
    return { queued: n('QUEUED'), processing: n('PROCESSING'), doneToday: n('DONE'), limit: this.limit || null };
  }

  // ── worker ──

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const db = this.prisma.unscoped();
      const { enabled, cfg } = await this.settings.current();
      // Revive jobs cut off by a restart.
      await db.aiReviewJob.updateMany({ where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'QUEUED' } });
      if (!enabled || !cfg.apiKey) {
        // Switched off: every waiting file is simply accepted, as before the feature.
        const waiting = await db.aiReviewJob.findMany({ where: { status: 'QUEUED' }, select: { id: true, documentId: true }, take: 500 });
        for (const j of waiting) {
          await db.document.update({ where: { id: j.documentId }, data: { aiStatus: null } }).catch(() => undefined);
          await db.aiReviewJob.update({ where: { id: j.id }, data: { status: 'DONE', finishedAt: new Date(), lastError: 'disabled' } });
        }
        return;
      }
      const max = Math.max(1, Math.min(50, cfg.maxConcurrency));
      if (!this.limit || this.limit > max) this.limit = max;
      if (Date.now() < this.pausedUntil) return;
      const free = this.limit - this.running;
      if (free <= 0) return;
      const jobs = await this.claim(free);
      for (const j of jobs) {
        this.running++;
        this.run(j).finally(() => { this.running--; setImmediate(() => this.pump().catch(() => undefined)); });
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Atomically take up to `n` due jobs, keeping the cap global across API processes. */
  private async claim(n: number): Promise<{ id: string; documentId: string; claimId: string; attempts: number }[]> {
    const db = this.prisma.unscoped();
    const [, rows] = await db.$transaction([
      db.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`,
      db.$queryRaw<{ id: string; documentId: string; claimId: string; attempts: number }[]>`
        UPDATE "AiReviewJob" SET "status" = 'PROCESSING', "lockedAt" = now(), "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "AiReviewJob" WHERE "status" = 'QUEUED' AND "runAfter" <= now()
          ORDER BY "createdAt" LIMIT GREATEST(0, LEAST(${n}::int, ${this.limit}::int - (SELECT count(*)::int FROM "AiReviewJob" WHERE "status" = 'PROCESSING')))
          FOR UPDATE SKIP LOCKED)
        RETURNING "id", "documentId", "claimId", "attempts"`,
    ]);
    return rows;
  }

  private async run(job: { id: string; documentId: string; claimId: string; attempts: number }) {
    const db = this.prisma.unscoped();
    const finish = async (doc: Record<string, unknown>, err?: string) => {
      await db.document.update({ where: { id: job.documentId }, data: { ...doc, aiCheckedAt: new Date() } }).catch(() => undefined);
      await db.aiReviewJob.update({ where: { id: job.id }, data: { status: 'DONE', finishedAt: new Date(), lastError: err ?? null } });
    };
    try {
      const doc = await db.document.findUnique({ where: { id: job.documentId }, select: { docCode: true, mimeType: true, fileName: true, storageKey: true, sizeBytes: true } });
      const claim = await db.claim.findUnique({ where: { id: job.claimId }, select: { insurerTenantId: true, claimType: true } });
      if (!doc || !claim) return finish({ aiStatus: null }, 'gone');
      await db.document.update({ where: { id: job.documentId }, data: { aiStatus: 'PROCESSING' } });
      if (!READABLE.has(doc.mimeType) || doc.sizeBytes > MAX_FILE_BYTES) {
        return finish({ aiStatus: 'UNSURE', aiReason: 'این نوع فایل را هوش مصنوعی نمی‌خواند؛ کارشناس بررسی می‌کند.' });
      }
      const reqs = await db.requiredDocument.findMany({
        where: { tenantId: claim.insurerTenantId, isActive: true },
        orderBy: { order: 'asc' }, select: { code: true, label: true, appliesToTypes: true },
      });
      const prompts = await this.settings.promptMap();
      const cand = (r: { code: string; label: string }): DocCandidate => ({ code: r.code, label: r.label, prompt: prompts.get(r.code) });
      const expectedRow = reqs.find((r) => r.code === doc.docCode);
      if (!expectedRow) return finish({ aiStatus: null }, 'no slot'); // «سایر مدارک» etc.: no slot to compare with
      // Candidates: this case type's documents first (the likely confusions), then the rest of the catalog.
      const ordered = [...reqs.filter((r) => r.appliesToTypes.includes(claim.claimType)), ...reqs.filter((r) => !r.appliesToTypes.includes(claim.claimType))];
      const { cfg } = await this.settings.current();
      const file = await this.storage.read(doc.storageKey);
      const { result, requestId } = await this.avalai.classify({
        apiKey: cfg.apiKey!, model: cfg.model, file, mimeType: doc.mimeType, fileName: doc.fileName,
        expected: cand(expectedRow), candidates: ordered.map(cand),
      });
      this.onSuccess();
      const other = result.detectedCode !== doc.docCode;
      const status = !result.matches && other && result.confidence >= cfg.threshold ? 'MISMATCH'
        : result.matches && !other ? (result.confidence >= 0.5 ? 'MATCH' : 'UNSURE')
        : 'UNSURE';
      return finish({ aiStatus: status, aiDetectedCode: result.detectedCode, aiConfidence: result.confidence, aiReason: result.reason || null, aiRequestId: requestId });
    } catch (e) {
      if (e instanceof AvalaiRetryable) {
        if (e.rateLimited) this.onRateLimit(e.retryAfterSec);
        const giveUp = e.rateLimited ? job.attempts >= 30 : job.attempts >= 4;
        if (!giveUp) {
          await db.document.update({ where: { id: job.documentId }, data: { aiStatus: 'QUEUED' } }).catch(() => undefined);
          await db.aiReviewJob.update({
            where: { id: job.id },
            data: { status: 'QUEUED', lockedAt: null, lastError: e.message, runAfter: new Date(Date.now() + Math.max(e.retryAfterSec, 10 * job.attempts) * 1000) },
          });
          return;
        }
      }
      this.logger.warn(`AI check of document ${job.documentId} failed: ${String((e as Error).message).slice(0, 200)}`);
      if (!(e instanceof AvalaiRetryable) && job.attempts < 2) {
        await db.aiReviewJob.update({ where: { id: job.id }, data: { status: 'QUEUED', lockedAt: null, runAfter: new Date(Date.now() + 30_000), lastError: String((e as Error).message).slice(0, 300) } });
        return;
      }
      // Never block the user on our failure: accept the file and leave it to the کارشناس.
      await finish({ aiStatus: 'ERROR', aiReason: 'بررسی خودکار انجام نشد؛ کارشناس بررسی می‌کند.' }, String((e as Error).message).slice(0, 300));
    }
  }

  private onSuccess() {
    if (++this.wins >= this.limit) { this.wins = 0; this.settings.current().then(({ cfg }) => { this.limit = Math.min(Math.max(1, cfg.maxConcurrency), this.limit + 1); }).catch(() => undefined); }
  }
  private onRateLimit(retryAfterSec: number) {
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.wins = 0;
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + Math.min(retryAfterSec, 300) * 1000);
    this.logger.warn(`AvalAI rate limit: concurrency now ${this.limit}, pausing ${retryAfterSec}s`);
  }

  // ── result SMS ──

  /** One SMS per case and uploader once its checks are all done and nothing new came in for a minute. */
  private async notifySweep() {
    const db = this.prisma.unscoped();
    const due = await db.aiReviewJob.findMany({
      where: { status: 'DONE', notifiedAt: null, finishedAt: { lt: new Date(Date.now() - QUIET_MS) } },
      select: { claimId: true }, distinct: ['claimId'], take: 100,
    });
    for (const { claimId } of due) {
      const busy = await db.aiReviewJob.count({ where: { claimId, OR: [{ status: { not: 'DONE' } }, { finishedAt: { gte: new Date(Date.now() - QUIET_MS) } }] } });
      if (busy) continue;
      const jobs = await db.aiReviewJob.findMany({ where: { claimId, status: 'DONE', notifiedAt: null }, select: { id: true, notifyPhone: true, lastError: true } });
      await db.aiReviewJob.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { notifiedAt: new Date() } });
      if (jobs.every((j) => j.lastError === 'disabled')) continue; // AI was off: nothing to report
      const phones = [...new Set(jobs.map((j) => (j.notifyPhone ? this.crypto.decrypt(j.notifyPhone) : null)).filter((p): p is string => !!p))];
      if (!phones.length) continue;
      try { await this.notifyClaim(claimId, phones); } catch (e) { this.logger.error(`AI result SMS for claim ${claimId}: ${String(e)}`); }
    }
  }

  /** Slots whose newest file the AI refused (each still needs a correct file). */
  async refusedSlots(claimId: string) {
    const db = this.prisma.unscoped();
    const docs = await db.document.findMany({ where: { claimId, docCode: { not: null } }, orderBy: { createdAt: 'desc' }, select: { docCode: true, aiStatus: true, aiReason: true } });
    const latest = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (!latest.has(d.docCode!)) latest.set(d.docCode!, d);
    return [...latest.entries()].filter(([, d]) => d.aiStatus === 'MISMATCH').map(([code, d]) => ({ code, reason: d.aiReason }));
  }

  private async notifyClaim(claimId: string, phones: string[]) {
    const db = this.prisma.unscoped();
    const claim = await db.claim.findUnique({ where: { id: claimId }, select: { claimNumber: true, brokerTenantId: true, insurerTenantId: true, status: true } });
    if (!claim || claim.status === 'PAID') return;
    const gateway = claim.brokerTenantId ?? claim.insurerTenantId;
    const refused = await this.refusedSlots(claimId);
    for (const phone of phones) {
      let text: string;
      if (refused.length) {
        const token = randomBytes(24).toString('base64url');
        await db.caseUploadLink.create({ data: { tokenHash: sha256(token), claimId, phone: this.crypto.encrypt(phone), expiresAt: new Date(Date.now() + LINK_TTL_DAYS * 86_400_000) } });
        text = `پروندهٔ ${claim.claimNumber}: ${refused.length.toLocaleString('fa-IR')} مدرک در جای درست بارگذاری نشده است. برای بارگذاری دوبارهٔ همان مدارک: ${webBase()}/fix/${token}`;
      } else {
        text = `مدارک پروندهٔ ${claim.claimNumber} دریافت و بررسی شد و پرونده برای بررسی به کارشناس ارسال شد. نتیجه به‌زودی به شما اعلام می‌شود.`;
      }
      await this.sms.send(phone, text, gateway);
    }
  }
}
