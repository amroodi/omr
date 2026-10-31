import { BadRequestException, Injectable } from '@nestjs/common';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AVALAI_BASE, AvalaiClient } from './avalai.client';

/** «بررسی هوشمند مدارک» connection settings (encrypted in PlatformConfig.aiConfig). */
export interface AiConfig {
  apiKey?: string;
  model: string;
  /** Most AI calls running at once (the queue adapts below it on rate limits). */
  maxConcurrency: number;
  /** A file is refused only when the model is at least this sure it is another document. */
  threshold: number;
}
export const AI_DEFAULTS: AiConfig = { model: 'gemini-3.8-flash', maxConcurrency: 10, threshold: 0.85 };
const PLATFORM_ID = 'platform';

/** Super-admin switch, AvalAI key/model, per-org switches and the per-document-type pre-prompts. */
@Injectable()
export class AiReviewSettings {
  private cache: { at: number; enabled: boolean; cfg: AiConfig; stored: boolean } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly avalai: AvalaiClient,
  ) {}

  private async stored(): Promise<{ enabled: boolean; cfg: AiConfig }> {
    const r = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: PLATFORM_ID }, select: { aiReviewEnabled: true, aiConfig: true } });
    let cfg = { ...AI_DEFAULTS };
    if (r?.aiConfig) {
      try { cfg = { ...cfg, ...(JSON.parse(this.crypto.decrypt(r.aiConfig) ?? '{}') as Partial<AiConfig>) }; } catch { /* keep defaults */ }
    }
    return { enabled: !!r?.aiReviewEnabled, cfg };
  }

  /** Platform switch + config (key from the panel, else AVALAI_API_KEY), cached briefly — the queue asks often. */
  async current(): Promise<{ enabled: boolean; cfg: AiConfig; stored: boolean }> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache;
    const { enabled, cfg } = await this.stored();
    const stored = !!cfg.apiKey;
    if (!cfg.apiKey && process.env.AVALAI_API_KEY) cfg.apiKey = process.env.AVALAI_API_KEY;
    this.cache = { at: Date.now(), enabled, cfg, stored };
    return this.cache;
  }

  /** Is the check on for a case? Platform on, a key set, and neither its insurer nor its brokerage switched it off. */
  async enabledForClaim(claim: { insurerTenantId: string; brokerTenantId: string | null }): Promise<boolean> {
    const { enabled, cfg } = await this.current();
    if (!enabled || !cfg.apiKey) return false;
    const ids = [claim.insurerTenantId, claim.brokerTenantId].filter((x): x is string => !!x);
    const off = await this.prisma.unscoped().tenant.count({ where: { id: { in: ids }, aiReviewEnabled: false } });
    return off === 0;
  }

  /** Super admin view (the key is never sent back). */
  async settings() {
    const { enabled, cfg, stored } = await this.current();
    const orgs = await this.prisma.unscoped().tenant.findMany({ select: { id: true, name: true, kind: true, aiReviewEnabled: true }, orderBy: { name: 'asc' } });
    return {
      enabled, baseUrl: AVALAI_BASE, model: cfg.model, maxConcurrency: cfg.maxConcurrency, threshold: cfg.threshold,
      hasKey: !!cfg.apiKey, keyFromEnv: !stored && !!cfg.apiKey,
      orgs,
    };
  }

  async save(input: { enabled?: boolean; apiKey?: string; model?: string; maxConcurrency?: number; threshold?: number }) {
    const { cfg: cur } = await this.stored();
    const next: AiConfig = {
      apiKey: input.apiKey?.trim() ? input.apiKey.trim() : cur.apiKey, // empty = keep the stored key
      model: input.model?.trim() || cur.model,
      maxConcurrency: input.maxConcurrency ?? cur.maxConcurrency,
      threshold: input.threshold ?? cur.threshold,
    };
    if (!/^[\w.\-:/]{2,80}$/.test(next.model)) throw new BadRequestException('نام مدل نامعتبر است');
    const data = { ...(input.enabled !== undefined ? { aiReviewEnabled: input.enabled } : {}), aiConfig: this.crypto.encrypt(JSON.stringify(next)) };
    await this.prisma.unscoped().platformConfig.upsert({ where: { id: PLATFORM_ID }, update: data, create: { id: PLATFORM_ID, ...data } });
    this.cache = null;
    return this.settings();
  }

  async setOrg(tenantId: string, enabled: boolean) {
    await this.prisma.unscoped().tenant.update({ where: { id: tenantId }, data: { aiReviewEnabled: enabled } });
    return { ok: true };
  }

  /** AvalAI account credit (User API) — shown on the super-admin page; also proves the key works. */
  async credit() {
    const { cfg } = await this.current();
    if (!cfg.apiKey) throw new BadRequestException('کلید AvalAI تنظیم نشده است');
    try { return await this.avalai.credit(cfg.apiKey); } catch (e) { throw new BadRequestException(`AvalAI پاسخ نداد: ${String((e as Error).message).slice(0, 120)}`); }
  }

  // ── Pre-prompts per document type ──

  /** Every document type of every insurer catalog (one row per code), with its pre-prompt. */
  async prompts() {
    const db = this.prisma.unscoped();
    const [docs, prompts] = await Promise.all([
      db.requiredDocument.findMany({ select: { code: true, label: true, order: true }, orderBy: { order: 'asc' } }),
      db.aiDocPrompt.findMany(),
    ]);
    const byCode = new Map<string, { code: string; label: string }>();
    for (const d of docs) if (!byCode.has(d.code)) byCode.set(d.code, { code: d.code, label: d.label });
    const p = new Map(prompts.map((x) => [x.code, x.prompt]));
    return [...byCode.values()].map((d) => ({ ...d, prompt: p.get(d.code) ?? '' }));
  }

  async promptMap(): Promise<Map<string, string>> {
    return new Map((await this.prisma.unscoped().aiDocPrompt.findMany()).map((x) => [x.code, x.prompt]));
  }

  async setPrompt(code: string, prompt: string) {
    const db = this.prisma.unscoped();
    if (!prompt.trim()) { await db.aiDocPrompt.deleteMany({ where: { code } }); return { ok: true }; }
    await db.aiDocPrompt.upsert({ where: { code }, update: { prompt: prompt.trim() }, create: { code, prompt: prompt.trim() } });
    return { ok: true };
  }
}
