import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, RequireApiScopes } from '../../common/guards/api-key.guard';
import { Public } from '../../common/rbac/decorators';
import { API_SCOPES } from '../api-keys/api-keys.service';
import { PartnerService } from './partner.service';

/**
 * Public, API-key-authenticated endpoints for a customer's own backend (not the browser).
 * Authenticate with header `x-api-key: omr_live_xxx.xxxxx`. See docs/INTEGRATION.md.
 */
@Controller('partner')
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  @Public()
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes(API_SCOPES.CLAIM_STATUS)
  @Get('claim-status')
  claimStatus(@Query('claimNumber') claimNumber: string, @Query('nationalCode') nationalCode: string) {
    return this.partner.claimStatus(claimNumber, nationalCode);
  }
}
