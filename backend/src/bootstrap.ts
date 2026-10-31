import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { IncomingMessage } from 'http';
import { join } from 'path';
import { storage } from './media/storage';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: NestExpressApplication) {
  app.enableCors();
  // Keep the raw request body for webhook signature checks (Stripe signs the exact bytes).
  app.use(json({ limit: '1mb', verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; } }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Admin CMS (static single page) at /admin/
  app.useStaticAssets(join(__dirname, '..', 'public'));
  // Uploaded/transcoded media (HLS, subtitles). Put a CDN in front of this in production.
  app.useStaticAssets(storage.root, {
    prefix: '/media/',
    setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
  });
  return app;
}
