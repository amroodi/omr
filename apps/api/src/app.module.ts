import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from './common/audit/audit.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RolesGuard } from './common/rbac/roles.guard';
import { RequestContextMiddleware } from './common/tenant/request-context.middleware';
import { TenantResolverGuard } from './common/tenant/tenant-resolver.guard';
import { CarriersModule } from './integrations/carriers/carriers.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomerModule } from './modules/customer/customer.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { InquiryModule } from './modules/inquiry/inquiry.module';
import { RolesModule } from './modules/roles/roles.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    PrismaModule,
    CryptoModule,
    AuditModule,
    RateLimitModule,
    CarriersModule,
    AuthModule,
    InquiryModule,
    RolesModule,
    UsersModule,
    DocumentsModule,
    CustomerModule,
    SharingModule,
  ],
  providers: [
    TenantResolverGuard,
    // Global auth + RBAC. @Public() opts a route out of auth; @Permissions()/@SuperAdminOnly()
    // add authorization on top. Order matters: JwtAuthGuard runs before RolesGuard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
