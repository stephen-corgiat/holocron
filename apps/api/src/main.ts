import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const appModule = await AppModule.register();
  const app = await NestFactory.create(appModule);
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const webOrigin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173';
  app.enableCors({ origin: webOrigin, credentials: true });

  const port = Number(config.get<string>('API_PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[holocron] api listening on :${port}`);
}

bootstrap();
