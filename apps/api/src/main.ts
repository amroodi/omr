import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Exactly one reverse proxy (Nginx on the same host). This makes req.ip the real client IP from
  // the proxy's X-Forwarded-For and ignores any XFF a client tries to spoof past that hop — so the
  // per-IP rate limits (OTP, login) can't be bypassed by rotating the header.
  // (Nginx must forward it: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Security headers: CSP, HSTS, no-sniff, frame-deny.
  app.use(helmet());

  // CORS allowlist per tenant domain — no wildcard with credentials.
  const origins = (config.get<string>('CORS_ORIGINS', '') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: true });

  // Reject unknown/oversized payloads; strip properties not in DTOs.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.setGlobalPrefix('api/v1');

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  // Bind to localhost by default: the API is always reached through the Nginx reverse proxy, so it
  // must not be exposed on the public interface even if a firewall rule is missing. Override with
  // HOST=0.0.0.0 only for setups that genuinely need it.
  const port = Number(config.get('PORT', 4000));
  const host = config.get<string>('HOST', '127.0.0.1');
  await app.listen(port, host);
  logger.log(`OMR Damuon API listening on http://${host}:${port}/api/v1`);
}

bootstrap();
