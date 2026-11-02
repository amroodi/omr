import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { ALERT_KINDS, SessionsService } from './sessions.service';

class AlertSettingsDto {
  @IsOptional() @IsBoolean() smsEnabled?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) phones?: string[];
  @IsOptional() @IsArray() @IsIn(ALERT_KINDS as unknown as string[], { each: true }) kinds?: string[];
  @IsOptional() @IsArray() @IsIn(['ORG', 'SUPER', 'CUSTOMER', 'INSURED'], { each: true }) realms?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(24) workHoursStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24) workHoursEnd?: number;
  @IsOptional() @IsBoolean() offHoursFriday?: boolean;
}

class EndAllDto {
  @IsIn(['ORG', 'SUPER', 'CUSTOMER', 'INSURED']) realm!: string;
  @IsString() actorId!: string;
}

class SeenDto {
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
}

/** Any signed-in user: «خروج» ends their own session on the server too. */
@Controller('security')
export class SecurityController {
  constructor(private readonly sessions: SessionsService) {}

  @Post('logout')
  logout() {
    return this.sessions.logout();
  }
}

/** «امنیت ورود» for the Super Admin: sessions, alerts, and who gets the alert SMS. */
@SuperAdminOnly()
@Controller('platform/security')
export class SecurityAdminController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('sessions')
  list(@Query() q: { active?: string; actor?: string; realm?: string; device?: string; page?: string }) {
    return this.sessions.sessions(q);
  }

  @Post('sessions/:id/end')
  end(@Param('id') id: string) {
    return this.sessions.endByAdmin(id);
  }

  @Post('sessions/end-all')
  endAll(@Body() dto: EndAllDto) {
    return this.sessions.endAllOf(dto.realm, dto.actorId);
  }

  @Get('alerts')
  alerts(@Query() q: { unseen?: string; kind?: string; page?: string }) {
    return this.sessions.alerts(q);
  }

  @Post('alerts/seen')
  seen(@Body() dto: SeenDto) {
    return this.sessions.markSeen(dto.ids);
  }

  @Get('settings')
  settings() {
    return this.sessions.settings();
  }

  @Put('settings')
  save(@Body() dto: AlertSettingsDto) {
    return this.sessions.saveSettings(dto);
  }

  @Post('settings/test-sms')
  test() {
    return this.sessions.testSms();
  }
}
