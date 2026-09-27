import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env, isProd } from './config/env';
import { api } from './routes';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { prisma } from './lib/prisma';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Needed so req.ip / req.secure reflect the client behind a TLS-terminating proxy.
  app.set('trust proxy', env.TRUST_PROXY);

  // HTTPS only outside local development.
  if (isProd) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.secure) return next();
      res.status(403).json({ error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' } });
    });
  }

  app.use(
    helmet({
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Native app and server-to-server calls send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(
    express.json({
      limit: '32kb',
      // Raw body is needed to verify device request signatures.
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(cookieParser());
  app.use(globalLimiter);

  app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
