import { EntryAllowed, Realms } from '../../common/rbac/decorators';
import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/** In-panel notifications for the signed-in actor (org user or بیمه‌گزار). Requires a token. */
// Panel 1 reads (and marks read) its own notices too: without this, its bell could never be cleared.
@EntryAllowed()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Realms('ORG', 'CUSTOMER')
  @Get()
  list() {
    return this.notifications.list();
  }

  @Realms('ORG', 'CUSTOMER')
  @Get('unread-count')
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Realms('ORG', 'CUSTOMER')
  @Post('read-all')
  readAll(@Query('kind') kind?: string) {
    return this.notifications.markAllRead(kind);
  }

  @Realms('ORG', 'CUSTOMER')
  @Post('claim/:claimId/read')
  readClaim(@Param('claimId', new ParseUUIDPipe()) claimId: string) {
    return this.notifications.markClaimRead(claimId);
  }

  @Realms('ORG', 'CUSTOMER')
  @Post(':id/read')
  read(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }
}
