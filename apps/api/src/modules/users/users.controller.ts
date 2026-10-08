import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Permissions(PERMISSIONS.USER_MANAGE)
  @Get()
  list() {
    return this.users.list();
  }

  @Permissions(PERMISSIONS.USER_MANAGE)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Permissions(PERMISSIONS.USER_MANAGE)
  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(id, dto.password);
  }

  @Permissions(PERMISSIONS.USER_MANAGE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
