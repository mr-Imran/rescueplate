import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { loadUser, requestId, sameOriginOnly } from './auth/middleware.js';
import { config } from './config.js';
import { AppError, notFound, toHttpError } from './lib/errors.js';
import { buildRoutes } from './routes.js';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1); // behind the host's HTTPS proxy: correct client IPs and secure cookies

  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          // Free street tiles (Esri) + Nominatim reverse-geocode for location picker / live track.
          imgSrc: ["'self'", 'data:', 'https://server.arcgisonline.com', 'https://*.arcgisonline.com'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https://nominatim.openstreetmap.org'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
    }),
  );
  app.use(compression());

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: Number(process.env.API_RATE_LIMIT || 600),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => config.isTest,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.')),
    }),
  );
  api.use(sameOriginOnly);
  api.use(express.json({ limit: '50kb' }));
  api.use(loadUser);
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); // API responses are per-user and always live
    if (config.logRequests) {
      const started = Date.now();
      res.on('finish', () => {
        if (req.method !== 'GET' || res.statusCode >= 400) {
          console.log(`[${req.id}] ${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode} ${Date.now() - started}ms`);
        }
      });
    }
    next();
  });
  api.use(buildRoutes());
  api.use((_req, _res, next) => next(notFound('Route')));
  app.use('/api', api);

  // The built single-page app (production). In development Vite serves the client instead.
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h', setHeaders: (res, file) => file.includes(`${path.sep}assets${path.sep}`) && res.set('Cache-Control', 'public, max-age=31536000, immutable') }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || path.extname(req.path)) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }
  app.use((_req, _res, next) => next(notFound('Page')));

  // Single error handler: every failure leaves the server as a clean JSON error.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const { status, body, retryAfter } = toHttpError(err, req.id);
    if (status >= 500) console.error(`[${req.id}] ${req.method} ${req.originalUrl} failed:`, err);
    if (retryAfter) res.set('Retry-After', String(retryAfter));
    if (res.headersSent) return res.end();
    res.status(status).json(body);
  });

  return app;
}
