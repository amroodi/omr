import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ClaimsService } from './claims.service';
import { DecisionDto, FileClaimDto } from './dto';

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  /** File a death claim (بیمه‌گزار / broker on their behalf). */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post()
  file(@Body() dto: FileClaimDto) {
    return this.claims.file(dto);
  }

  /** The caller's action queue (claims awaiting their step). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get('queue')
  queue() {
    return this.claims.queue();
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.claims.get(id);
  }

  /** معرف forwards / insurer level endorses (engine routes by authority ceiling). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/endorse')
  endorse(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.decide(id, 'ENDORSE', dto);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/return-incomplete')
  returnIncomplete(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.decide(id, 'RETURN_INCOMPLETE', dto);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.decide(id, 'REJECT', dto);
  }

  /** بیمه‌گزار resolves deficiencies and resubmits (restarts the chain). */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post(':id/rectify')
  rectify(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.rectify(id, dto.note);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/pay')
  pay(@Param('id') id: string) {
    return this.claims.markPaid(id);
  }
}
