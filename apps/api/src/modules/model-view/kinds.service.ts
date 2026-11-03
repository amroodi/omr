import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { allKinds, KIND_CODE, kindsFrom, kindsOf, PolicyKind, setKinds } from '../../common/kinds';

/**
 * Super Admin's نوع بیمه‌نامه catalog and each organization's choice of kinds for its panel 1.
 * A kind in use (a contract or a case carries it) can be hidden but not deleted.
 */
@Injectable()
export class KindsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async onModuleInit() { await this.reload(); }

  async reload() {
    const pc = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { policyKinds: true } }).catch(() => null);
    setKinds(kindsFrom(pc?.policyKinds));
  }

  /** The catalog with, for each kind, how many contracts and cases carry it (those can't be deleted). */
  async catalog() {
    const db = this.prisma.unscoped();
    const [k, c, orgs] = await Promise.all([
      db.policyholderContract.groupBy({ by: ['line'], _count: true }),
      db.claim.groupBy({ by: ['line'], where: { deletedAt: null }, _count: true }),
      db.tenant.findMany({ where: { kind: { in: ['BROKER', 'INSURER'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, kind: true, policyKinds: true } }),
    ]);
    const n = (rows: { line: string | null; _count: number }[], code: string) => rows.find((r) => r.line === code)?._count ?? 0;
    return {
      kinds: allKinds().map((x) => ({ ...x, contracts: n(k, x.code), cases: n(c, x.code) })),
      orgs: orgs.map((o) => ({ id: o.id, name: o.name, kind: o.kind, kinds: o.policyKinds })),
    };
  }

  /** Save the whole catalog. New kinds get a code from their label's position; removed ones must be unused. */
  async save(input: { code?: string; label: string; active: boolean }[]) {
    const db = this.prisma.unscoped();
    const before = allKinds();
    const used = new Set([
      ...(await db.policyholderContract.findMany({ where: { line: { not: null } }, distinct: ['line'], select: { line: true } })).map((r) => r.line!),
      ...(await db.claim.findMany({ where: { line: { not: null } }, distinct: ['line'], select: { line: true } })).map((r) => r.line!),
    ]);
    const next: PolicyKind[] = [];
    for (const r of input) {
      const label = (r.label ?? '').trim();
      if (label.length < 2) throw new BadRequestException('نام هر نوع بیمه‌نامه دست‌کم دو حرف است');
      let code = (r.code ?? '').trim();
      if (!code) { let i = before.length + next.length + 1; do code = `KIND_${i++}`; while (before.some((b) => b.code === code) || next.some((b) => b.code === code)); }
      if (!KIND_CODE.test(code)) throw new BadRequestException('کد نوع بیمه‌نامه نامعتبر است');
      if (next.some((x) => x.code === code)) throw new BadRequestException('کد تکراری است');
      if (next.some((x) => x.label === label)) throw new BadRequestException(`نام «${label}» تکراری است`);
      next.push({ code, label: label.slice(0, 60), active: r.active !== false });
    }
    if (!next.some((x) => x.active)) throw new BadRequestException('دست‌کم یک نوع بیمه‌نامه باید فعال باشد');
    const removed = before.filter((b) => !next.some((x) => x.code === b.code));
    const blocked = removed.filter((b) => used.has(b.code));
    if (blocked.length) throw new BadRequestException(`«${blocked.map((b) => b.label).join('، ')}» قرارداد یا پرونده دارد و حذف نمی‌شود؛ آن را غیرفعال کنید`);
    await db.platformConfig.upsert({ where: { id: 'platform' }, update: { policyKinds: next as unknown as Prisma.InputJsonValue }, create: { id: 'platform', policyKinds: next as unknown as Prisma.InputJsonValue } });
    // A deleted kind leaves no trace in the organizations' choices or in the documents.
    for (const r of removed) {
      await db.$executeRaw`UPDATE "Tenant" SET "policyKinds" = array_remove("policyKinds", ${r.code})`;
      await db.$executeRaw`UPDATE "RequiredDocument" SET "kinds" = array_remove("kinds", ${r.code})`;
    }
    setKinds(next);
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', targetType: 'PolicyKinds', metadata: { before, after: next } as any });
    return this.catalog();
  }

  /** Which kinds an organization's panel 1 offers (empty = every active kind). */
  async setOrgKinds(tenantId: string, kinds: string[]) {
    const known = new Set(allKinds().map((k) => k.code));
    const list = [...new Set(kinds.filter((k) => known.has(k)))];
    const t = await this.prisma.unscoped().tenant.update({ where: { id: tenantId }, data: { policyKinds: list }, select: { id: true, policyKinds: true } });
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', tenantId, targetType: 'TenantPolicyKinds', targetId: tenantId, metadata: { kinds: list } });
    return t;
  }

  /** Kinds an organization's panel 1 offers, for its login drawer and top-bar switch. */
  async forOrg(tenantId: string) {
    const t = await this.prisma.unscoped().tenant.findUnique({ where: { id: tenantId }, select: { policyKinds: true } });
    return kindsOf(t?.policyKinds).map(({ code, label }) => ({ code, label }));
  }

  /** Panel 1 filing: is this kind open to the caller's organization? */
  async assertOrgKind(tenantId: string | undefined, line: string) {
    if (!tenantId) return;
    if (!(await this.forOrg(tenantId)).some((k) => k.code === line)) throw new BadRequestException('این نوع بیمه‌نامه برای این سازمان فعال نیست');
  }
}
