import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from "prisma/config";
import "dotenv/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:10000',
      process.env.FRONTEND ?? env("FRONTEND"),
      process.env.BACKEND2 ?? env("BACKEND2"),
    ],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, Cookie',
  });

  await app.listen(process.env.PORT ?? 10000);

  console.log('');
  console.log('='.repeat(50));
  console.log(`🚀 Server is running`);
  console.log(`📍 HTTP: http://localhost:10000`);
  console.log('='.repeat(50));
  console.log('');
}
bootstrap();
