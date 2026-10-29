import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';
import { NormalizingValidationPipe } from './common/validation/normalizing-validation.pipe';

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
    new NormalizingValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
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

/**
 * `API_WORKERS` > 1 runs that many API processes on one port (Node cluster), so the API uses every CPU
 * core instead of one. Safe because nothing per-request lives in a single process: rate limits are in
 * Postgres, reminders are claimed in the database, files are on the shared disk. `API_WORKERS=auto`
 * = one per core. A worker that dies is restarted. Default 1 (a single process, as before).
 */
function start(): void {
  const raw = String(process.env.API_WORKERS ?? '1').trim().toLowerCase();
  const n = raw === 'auto' ? availableParallelism() : Math.max(1, Math.min(64, Number(raw) || 1));
  if (n <= 1 || !cluster.isPrimary) { bootstrap(); return; }
  const logger = new Logger('Cluster');
  logger.log(`Starting ${n} API workers`);
  for (let i = 0; i < n; i++) cluster.fork();
  let stopping = false;
  const stop = () => { stopping = true; for (const w of Object.values(cluster.workers ?? {})) w?.kill('SIGTERM'); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  cluster.on('exit', (w, code, signal) => {
    if (stopping) { if (!Object.keys(cluster.workers ?? {}).length) process.exit(0); return; }
    logger.error(`API worker ${w.process.pid} exited (${signal || code}); starting a new one`);
    setTimeout(() => cluster.fork(), 1000);
  });
}

start();
