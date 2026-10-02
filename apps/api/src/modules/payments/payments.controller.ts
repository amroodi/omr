import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { DecisionDto, ProposePaymentDto } from './dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Maker proposes a payout (awaits a second-person approval). */
  @Permissions(PERMISSIONS.PAYMENT_PROPOSE)
  @Post()
  propose(@Body() dto: ProposePaymentDto) {
    return this.payments.propose(dto);
  }

  @Permissions(PERMISSIONS.CASE_READ)
  @Get()
  listByCase(@Query('caseId') caseId: string) {
    return this.payments.listByCase(caseId);
  }

  /** Approver queue — payouts awaiting authorization. */
  @Permissions(PERMISSIONS.PAYMENT_APPROVE)
  @Get('pending-approval')
  pending() {
    return this.payments.pendingApprovals();
  }

  @Permissions(PERMISSIONS.PAYMENT_APPROVE)
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.payments.approve(id, dto.note);
  }

  @Permissions(PERMISSIONS.PAYMENT_APPROVE)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.payments.reject(id, dto.note);
  }
}
