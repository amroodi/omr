import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { RemindersService } from './reminders.service';

class CreateReminderDto {
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsString() @Length(1, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
  @IsISO8601() dueAt!: string;
  @IsOptional() @IsUUID() claimId?: string;
  @IsOptional() @IsBoolean() sms?: boolean;
}

class DoneDto {
  @IsBoolean() done!: boolean;
}

/** «یادآور»: any operator who can read cases may remind themself or a colleague. */
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get()
  list() {
    return this.reminders.list();
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('colleagues')
  colleagues() {
    return this.reminders.colleagues();
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Post()
  create(@Body() dto: CreateReminderDto) {
    return this.reminders.create(dto);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Post(':id/done')
  done(@Param('id') id: string, @Body() dto: DoneDto) {
    return this.reminders.setDone(id, dto.done);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reminders.remove(id);
  }
}
