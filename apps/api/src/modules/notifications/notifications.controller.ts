import { Controller, Get, Param, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/** In-panel notifications for the signed-in actor (org user or بیمه‌گزار). Requires a token. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list() {
    return this.notifications.list();
  }

  @Get('unread-count')
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post('read-all')
  readAll() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  read(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }
}
