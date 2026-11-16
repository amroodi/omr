import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';

const USERNAME = /^[a-z0-9._-]{3,60}$/;
class DoctorDto {
  @IsString() @Length(2, 120) fullName!: string;
  @IsString() @Matches(USERNAME, { message: 'نام کاربری: حروف کوچک لاتین، عدد، نقطه، خط تیره (۳ تا ۶۰)' }) username!: string;
  @IsOptional() @IsString() @Length(8, 128) password?: string;
  @IsOptional() @IsString() @Length(0, 20) @Matches(/^[\d۰-۹+\- ]*$/) phone?: string;
  @IsOptional() @IsString() @Length(0, 30) medicalCode?: string;
  @IsOptional() @IsString() @Length(0, 80) specialty?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) insurerIds!: string[];
}
class PasswordDto {
  @IsString() @Length(8, 128) password!: string;
}

/**
 * Super Admin › «پزشکان معتمد»: the doctors' own accounts (not an insurer's users) and the insurers each one
 * works with. Only a doctor linked to an insurer appears in that insurer's «انتخاب پزشک معتمد».
 */
@SuperAdminOnly()
@Controller('admin/doctors')
export class DoctorsAdminController {
  constructor(private readonly prisma: PrismaService, private readonly hash: HashService, private readonly audit: AuditService) {}

  @Get()
  async list() {
    const db = this.prisma.unscoped();
    const [doctors, insurers, open] = await Promise.all([
      db.doctor.findMany({ orderBy: { fullName: 'asc' }, include: { insurers: { select: { insurerTenantId: true } } } }),
      db.tenant.findMany({ where: { kind: 'INSURER' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.doctorReferral.groupBy({ by: ['doctorId'], where: { status: 'PENDING' }, _count: true }),
    ]);
    const pending = new Map(open.map((o) => [o.doctorId, o._count]));
    return {
      insurers,
      doctors: doctors.map((d) => ({
        id: d.id, fullName: d.fullName, username: d.username, phone: d.phone, medicalCode: d.medicalCode, specialty: d.specialty, isActive: d.isActive,
        lastLoginAt: d.lastLoginAt, insurerIds: d.insurers.map((x) => x.insurerTenantId), pending: pending.get(d.id) ?? 0,
      })),
    };
  }

  private async insurerIds(ids: string[]) {
    const ok = await this.prisma.unscoped().tenant.findMany({ where: { id: { in: ids }, kind: 'INSURER' }, select: { id: true } });
    if (ok.length !== new Set(ids).size) throw new BadRequestException('بیمه‌گر نامعتبر است');
    return ok.map((t) => t.id);
  }

  @Post()
  async create(@Body() dto: DoctorDto) {
    if (!dto.password) throw new BadRequestException('رمز عبور (دست‌کم ۸ نویسه) را وارد کنید');
    const db = this.prisma.unscoped();
    const username = dto.username.trim().toLowerCase();
    if (await db.doctor.findUnique({ where: { username } })) throw new BadRequestException('این نام کاربری پیش‌تر ثبت شده است');
    const ids = await this.insurerIds(dto.insurerIds);
    const d = await db.doctor.create({
      data: {
        fullName: dto.fullName.trim(), username, passwordHash: await this.hash.hashPassword(dto.password), phone: dto.phone?.trim() || null,
        medicalCode: dto.medicalCode?.trim() || null, specialty: dto.specialty?.trim() || null, isActive: dto.isActive ?? true,
        insurers: { create: ids.map((insurerTenantId) => ({ insurerTenantId })) },
      },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'Doctor', targetId: d.id, metadata: { username, insurers: ids } });
    return { id: d.id };
  }

  @Put(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DoctorDto) {
    const db = this.prisma.unscoped();
    const d = await db.doctor.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('پزشک یافت نشد');
    const username = dto.username.trim().toLowerCase();
    if (username !== d.username && (await db.doctor.findUnique({ where: { username } }))) throw new BadRequestException('این نام کاربری پیش‌تر ثبت شده است');
    const ids = await this.insurerIds(dto.insurerIds);
    await db.$transaction([
      db.doctor.update({ where: { id }, data: {
        fullName: dto.fullName.trim(), username, phone: dto.phone?.trim() || null, medicalCode: dto.medicalCode?.trim() || null, specialty: dto.specialty?.trim() || null,
        isActive: dto.isActive ?? d.isActive, ...(dto.password ? { passwordHash: await this.hash.hashPassword(dto.password) } : {}),
      } }),
      db.doctorInsurer.deleteMany({ where: { doctorId: id, insurerTenantId: { notIn: ids } } }),
      ...ids.map((insurerTenantId) => db.doctorInsurer.upsert({ where: { doctorId_insurerTenantId: { doctorId: id, insurerTenantId } }, update: {}, create: { doctorId: id, insurerTenantId } })),
    ]);
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'Doctor', targetId: id, metadata: { username, insurers: ids, isActive: dto.isActive ?? d.isActive, passwordChanged: !!dto.password } });
    return { ok: true };
  }

  @Post(':id/password')
  async password(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PasswordDto) {
    const db = this.prisma.unscoped();
    if (!(await db.doctor.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('پزشک یافت نشد');
    await db.doctor.update({ where: { id }, data: { passwordHash: await this.hash.hashPassword(dto.password) } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'Doctor', targetId: id, metadata: { passwordReset: true } });
    return { ok: true };
  }

  /** A doctor with no referrals is removed; one with referrals is deactivated instead (their answers stay on the cases). */
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const db = this.prisma.unscoped();
    const used = await db.doctorReferral.count({ where: { doctorId: id } });
    if (used) await db.doctor.update({ where: { id }, data: { isActive: false } });
    else await db.doctor.delete({ where: { id } });
    await this.audit.record({ action: used ? AuditAction.EDIT : AuditAction.DELETE, targetType: 'Doctor', targetId: id, metadata: used ? { deactivated: true } : {} });
    return { removed: !used, deactivated: !!used };
  }
}
