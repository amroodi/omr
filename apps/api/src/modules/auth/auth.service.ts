import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
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

export interface TokenResult {
  token: string;
  expiresIn: string;
  actor: { id: string; displayName: string; permissions: string[] };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  async orgLogin(dto: OrgLoginDto): Promise<TokenResult> {
    const ip = getContext()?.ip ?? 'unknown';
    // Login runs before any tenant context, so use the un-scoped client deliberately.
    const db = this.prisma.unscoped();

    if (!this.rateLimit.hit(`login:ip:${ip}`, 20, 900)) {
      throw new TooManyRequestsException('Too many login attempts');
    }
    if (!this.rateLimit.hit(`login:user:${dto.tenantSlug}:${dto.username}`, 8, 900)) {
      throw new TooManyRequestsException('Too many login attempts');
    }

    const tenant = await db.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      select: { id: true, isActive: true },
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

    // TODO: if user.totpSecret set, verify dto.totp here (TOTP) before issuing a token.

    const permissions = user!.role?.permissions ?? [];
    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync(
      { kind: 'org', sub: user!.id, tenantId: tenant.id, permissions, branchId: user!.branchId ?? null },
      { expiresIn },
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
    };
  }

  async superAdminLogin(dto: SuperAdminLoginDto): Promise<TokenResult> {
    const ip = getContext()?.ip ?? 'unknown';
    const db = this.prisma.unscoped();
    if (!this.rateLimit.hit(`superlogin:ip:${ip}`, 10, 900)) {
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

    // TODO: enforce TOTP for super-admins (recommended mandatory).
    const permissions = ['tenant:manage'];
    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync(
      { kind: 'super', sub: admin!.id, permissions },
      { expiresIn },
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
