import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CreateRoleDto, UpdateRoleDto } from './dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Permission catalog for building the role editor UI. */
  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Get('catalog')
  catalog() {
    return this.roles.catalog();
  }

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Get()
  list() {
    return this.roles.list();
  }

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Post()
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto.name, dto.permissions);
  }

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roles.remove(id);
  }
}
