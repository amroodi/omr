import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsArray, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { API_SCOPES, ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @IsString() @Length(2, 80) name!: string;
  @IsArray() @IsString({ each: true }) scopes!: string[];
  @IsOptional() @IsISO8601() expiresAt?: string;
}

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  /** Available scopes, for the management UI. */
  @Permissions(PERMISSIONS.API_KEY_MANAGE)
  @Get('scopes')
  scopes() {
    return Object.values(API_SCOPES);
  }

  @Permissions(PERMISSIONS.API_KEY_MANAGE)
  @Get()
  list() {
    return this.svc.list();
  }

  @Permissions(PERMISSIONS.API_KEY_MANAGE)
  @Post()
  create(@Body() dto: CreateApiKeyDto) {
    return this.svc.create(dto);
  }

  @Permissions(PERMISSIONS.API_KEY_MANAGE)
  @Post(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.svc.revoke(id);
  }
}
