import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { Env } from './config';
import type { DbPool } from './db/pool';
import { healthRouter } from './api/routes/health';
import { statusRouter } from './api/routes/status';
import { marketRouter } from './api/routes/market';
import { statusStreamRouter } from './api/stream/statusSSE';

export function createApp(env: Env, deps: { pool: DbPool; statusSource: () => Promise<any> }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 10_000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/api/health', healthRouter(env, deps.pool));
  app.use('/api/status', statusRouter(deps.statusSource));
  app.use('/api/stream/status', statusStreamRouter(deps.statusSource));
  app.use('/api', marketRouter(deps.pool));

  return app;
}

