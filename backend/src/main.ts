import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { config } from './config';

async function main() {
  // Fail fast on bad configuration before accepting traffic.
  void config.jwtSecret, config.adminApiKey, config.purchaseVerifier;
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port);
}
void main();
