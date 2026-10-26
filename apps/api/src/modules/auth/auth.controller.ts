import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentActor, Public } from '../../common/rbac/decorators';
import type { RequestContext } from '../../common/tenant/tenant-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, OrgLoginDto, SuperAdminLoginDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
    return this.auth.me(actor?.actorType, actor?.actorId);
  }

  /** Change the signed-in actor's own password (super-admin or org user). Requires a valid token. */
  @Post('change-password')
  changePassword(@CurrentActor() actor: RequestContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(actor?.actorType, actor?.actorId, dto.currentPassword, dto.newPassword);
  }
}
