import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentActor, Public } from '../../common/rbac/decorators';
import type { RequestContext } from '../../common/tenant/tenant-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, MfaCodeDto, MfaDisableDto, MfaSetupDto, OrgLoginDto, SuperAdminLoginDto } from './dto';
import { MfaService } from './mfa.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly mfa: MfaService) {}

  // ── Two-step login (authenticator app) for the signed-in org user / super admin ──
  @Get('mfa')
  mfaStatus() {
    return this.mfa.status();
  }

  @Post('mfa/setup')
  mfaSetup(@Body() dto: MfaSetupDto) {
    return this.mfa.setup(dto.password);
  }

  @Post('mfa/enable')
  mfaEnable(@Body() dto: MfaCodeDto) {
    return this.mfa.enable(dto.code);
  }

  @Post('mfa/disable')
  mfaDisable(@Body() dto: MfaDisableDto) {
    return this.mfa.disable(dto.password, dto.code);
  }

  @Public()
  @Post('org/login')
  orgLogin(@Body() dto: OrgLoginDto) {
    return this.auth.orgLogin(dto);
  }

  @Public()
  @Post('super/login')
  superLogin(@Body() dto: SuperAdminLoginDto) {
    return this.auth.superAdminLogin(dto);
  }

  /** Who is signed in — the top bar's «نام کاربر». */
  @Get('me')
  me(@CurrentActor() actor: RequestContext) {
    return this.auth.me(actor?.actorType, actor?.actorId, actor?.panel);
  }

  /** Change the signed-in actor's own password (super-admin or org user). Requires a valid token. */
  @Post('change-password')
  changePassword(@CurrentActor() actor: RequestContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(actor?.actorType, actor?.actorId, dto.currentPassword, dto.newPassword);
  }
}
