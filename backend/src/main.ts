import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './libs/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Our controller emits version-based ETags and handles If-None-Match itself,
  // so turn off Express's body-hash ETag to avoid double work.
  const http = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  http.set('etag', false);

  app.enableCors({ origin: true, exposedHeaders: ['ETag'] });
  app.enableShutdownHooks();
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`URL-checker API listening on port ${port}`);
}

void bootstrap();
