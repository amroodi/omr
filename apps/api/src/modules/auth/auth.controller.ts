import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/rbac/decorators';
import { AuthService } from './auth.service';
import { OrgLoginDto, SuperAdminLoginDto } from './dto';

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
}
