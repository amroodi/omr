import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtTtl } from '../../common/crypto/jwt-ttl';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext } from '../../common/tenant/tenant-context';
import { TooManyRequestsException } from '../inquiry/http-exceptions';
import { OrgLoginDto, SuperAdminLoginDto } from './dto';
import { MfaService } from './mfa.service';

export interface TokenResult {
  token: string;
  expiresIn: string;
  actor: { id: string; displayName: string; permissions: string[] };
  /** The org requires two-step login and this user must set it up before anything else. */
  mfaSetupRequired?: boolean;
  /** Which org panel this session is (کارگزاری / شعبه / ستاد / شورای فنی). */
  panel?: Panel;
}

/** The org panels — one per desk, each with its own login page. */
export type Panel = 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';
const PANEL_FA: Record<Panel, string> = { BROKER: 'پنل کارگزاری', BRANCH: 'پنل شعبه', HQ: 'پنل ستاد', COUNCIL: 'پنل شورای فنی' };

@Injectable()
export class AuthService {
  /** Display name of the signed-in org user / super admin (the panel's top bar). */
  async me(actorType?: string, actorId?: string, panel?: string): Promise<{ name: string | null; panel?: string | null }> {
    if (!actorId) return { name: null };
    const db = this.prisma.unscoped();
    if (actorType === 'ORG_USER') {
      const u = await db.orgUser.findUnique({ where: { id: actorId }, select: { displayName: true, username: true } });
      return { name: u?.displayName || u?.username || null, panel: panel ?? null };
    }
    if (actorType === 'SUPER_ADMIN') {
      const a = await db.superAdmin.findUnique({ where: { id: actorId }, select: { email: true } });
      return { name: a?.email ?? null };
    }
    return { name: null };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
  ) {}

  async orgLogin(dto: OrgLoginDto): Promise<TokenResult> {
    const ip = getContext()?.ip ?? 'unknown';
    // Login runs before any tenant context, so use the un-scoped client deliberately.
    const db = this.prisma.unscoped();

    if (!(await this.rateLimit.hit(`login:ip:${ip}`, 20, 900))) {
      throw new TooManyRequestsException('Too many login attempts');
    }
    if (!(await this.rateLimit.hit(`login:user:${dto.tenantSlug}:${dto.username}`, 8, 900))) {
      throw new TooManyRequestsException('Too many login attempts');
    }

    const tenant = await db.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      select: { id: true, isActive: true, requireMfa: true, kind: true },
    });
    const fail = () => new UnauthorizedException('نام کاربری یا رمز عبور نادرست است');

    if (!tenant || !tenant.isActive) throw fail();

    const user = await db.orgUser.findUnique({
      where: { tenantId_username: { tenantId: tenant.id, username: dto.username } },
      include: { role: true },
    });

    const ok = user && user.isActive && (await this.hash.verifyPassword(user.passwordHash, dto.password));
    if (!ok) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        tenantId: tenant.id,
        actorType: 'ORG_USER',
        metadata: { username: dto.username },
      });
      throw fail();
    }

    // Separate panels: کارگزاری, شعبه, ستاد and شورای فنی each have their own login page. The password
    // was right, so say which panel this account belongs to (an insurer admin may use any of its own).
    const home: Panel = tenant.kind === 'BROKER' ? 'BROKER' : user!.desk === 'HQ' || user!.desk === 'COUNCIL' || user!.desk === 'BRANCH' ? user!.desk : user!.branchId ? 'BRANCH' : 'HQ';
    const insurerAdmin = tenant.kind === 'INSURER' && (user!.role?.permissions ?? []).includes('claim:override');
    let panel: Panel = home;
    if (dto.panel && dto.panel !== home) {
      if (!(insurerAdmin && dto.panel !== 'BROKER')) {
        throw new ForbiddenException({ statusCode: 403, code: 'WRONG_PANEL', panel: home, message: `این حساب کاربری متعلق به «${PANEL_FA[home]}» است؛ از صفحهٔ ورود همان پنل وارد شوید.` });
      }
      panel = dto.panel;
    }

    // Two-step login: with an authenticator set up, the 6-digit code is required too.
    await this.mfa.check({ kind: 'ORG_USER', id: user!.id }, user!, dto.totp);
    // The org requires two-step login but this user hasn't set it up: a token that can only reach
    // the setup endpoints (see JwtAuthGuard) until they do.
    const mfaSetup = tenant.requireMfa && !user!.totpSecret;

    const permissions = user!.role?.permissions ?? [];
    const expiresIn = mfaSetup ? '15m' : this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync(
      { kind: 'org', sub: user!.id, tenantId: tenant.id, permissions, branchId: user!.branchId ?? null, panel, ...(mfaSetup ? { mfaSetup: true } : {}) },
      { expiresIn: jwtTtl(expiresIn) },
    );
    await db.orgUser.update({ where: { id: user!.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: AuditAction.LOGIN,
      tenantId: tenant.id,
      actorType: 'ORG_USER',
      actorId: user!.id,
    });

    return {
      token,
      expiresIn,
      actor: { id: user!.id, displayName: user!.displayName, permissions },
      panel,
      ...(mfaSetup ? { mfaSetupRequired: true } : {}),
    };
  }

  async superAdminLogin(dto: SuperAdminLoginDto): Promise<TokenResult> {
    const ip = getContext()?.ip ?? 'unknown';
    const db = this.prisma.unscoped();
    if (!(await this.rateLimit.hit(`superlogin:ip:${ip}`, 10, 900))) {
      throw new TooManyRequestsException('Too many login attempts');
    }

    const admin = await db.superAdmin.findUnique({ where: { email: dto.email } });
    const ok = admin && admin.isActive && (await this.hash.verifyPassword(admin.passwordHash, dto.password));
    if (!ok) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        actorType: 'SUPER_ADMIN',
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('اطلاعات ورود نادرست است');
    }

    // Two-step login for the super admin (strongly recommended — set it up in the admin panel).
    await this.mfa.check({ kind: 'SUPER_ADMIN', id: admin!.id }, admin!, dto.totp);
    const permissions = ['tenant:manage'];
    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync(
      { kind: 'super', sub: admin!.id, permissions },
      { expiresIn: jwtTtl(expiresIn) },
    );
    await this.audit.record({
      action: AuditAction.LOGIN,
      actorType: 'SUPER_ADMIN',
      actorId: admin!.id,
    });

    return { token, expiresIn, actor: { id: admin!.id, displayName: admin!.email, permissions } };
  }

  /** Change the signed-in actor's own password (super-admin or org user). */
  async changePassword(
    actorType: string | undefined,
    actorId: string | undefined,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    if (!actorId) throw new UnauthorizedException('نشست نامعتبر است');
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('رمز عبور جدید باید حداقل ۸ کاراکتر باشد');
    }
    const db = this.prisma.unscoped();

    if (actorType === 'SUPER_ADMIN') {
      const a = await db.superAdmin.findUnique({ where: { id: actorId } });
      if (!a || !(await this.hash.verifyPassword(a.passwordHash, currentPassword))) {
        throw new UnauthorizedException('رمز عبور فعلی نادرست است');
      }
      await db.superAdmin.update({ where: { id: actorId }, data: { passwordHash: await this.hash.hashPassword(newPassword) } });
      await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', actorId, targetType: 'SuperAdmin', targetId: actorId, metadata: { action: 'password-change' } });
      return { ok: true };
    }

    if (actorType === 'ORG_USER') {
      const u = await db.orgUser.findUnique({ where: { id: actorId } });
      if (!u || !(await this.hash.verifyPassword(u.passwordHash, currentPassword))) {
        throw new UnauthorizedException('رمز عبور فعلی نادرست است');
      }
      await db.orgUser.update({ where: { id: actorId }, data: { passwordHash: await this.hash.hashPassword(newPassword) } });
      await this.audit.record({ action: AuditAction.EDIT, tenantId: getContext()?.tenantId, actorType: 'ORG_USER', actorId, targetType: 'OrgUser', targetId: actorId, metadata: { action: 'password-change' } });
      return { ok: true };
    }

    throw new UnauthorizedException('این حساب امکان تغییر رمز از این مسیر را ندارد');
  }
}
