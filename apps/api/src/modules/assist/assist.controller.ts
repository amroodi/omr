import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { AssistService, AssistTarget } from './assist.service';

class AssistDto {
  @IsUUID() tenantId!: string;
  @IsIn(['ORG', 'COMPANY', 'REPRESENTATIVE']) target!: AssistTarget;
  @IsUUID() id!: string;
  @IsOptional() @IsIn(['ENTRY', 'PROCESS']) mode?: 'ENTRY' | 'PROCESS';
  @IsString() @Length(6, 8) totp!: string;
}

/** Super Admin «ورود به پنل» (see AssistService). */
@SuperAdminOnly()
@Controller('platform/assist')
export class AssistController {
  constructor(private readonly assist: AssistService) {}

  @Get('targets')
  targets(@Query('tenantId') tenantId: string) {
    return this.assist.targets(tenantId);
  }

  @Post()
  start(@Body() dto: AssistDto) {
    return this.assist.start(dto);
  }
}
