import 'dotenv/config';
import net from 'node:net';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function isRedisReachable(redisUrl?: string): Promise<boolean> {
    if (!redisUrl) {
        return false;
    }

    const parsed = new URL(redisUrl);
    const port = parsed.port ? Number(parsed.port) : 6379;

    return new Promise((resolve) => {
        const socket = net.createConnection({ host: parsed.hostname, port });
        const finish = (reachable: boolean) => {
            socket.destroy();
            resolve(reachable);
        };

        socket.setTimeout(750);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

async function bootstrap() {
    if (!(await isRedisReachable(process.env.REDIS_URL))) {
        process.env.SNAPGEN_DISABLE_QUEUE = 'true';
        console.warn('Redis is unavailable. Running API with inline media processing.');
    }

    const { AppModule } = await import('./app.module');
    const app = await NestFactory.create(AppModule);

    // Global prefix
    app.setGlobalPrefix('api');

    // CORS
    app.enableCors({
        origin: process.env.APP_URL || 'http://localhost:3000',
        credentials: true,
    });

    // Validation
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    // Swagger
    const config = new DocumentBuilder()
        .setTitle('SnapGen API')
        .setDescription('AI Image & Video Generation Platform API')
        .setVersion('1.0')
        .addBearerAuth()
        .addTag('auth', 'Authentication endpoints')
        .addTag('me', 'User profile endpoints')
        .addTag('billing', 'Billing and credit endpoints')
        .addTag('characters', 'Character management endpoints')
        .addTag('generations', 'Content generation endpoints')
        .addTag('jobs', 'Job management endpoints')
        .addTag('assets', 'Asset management endpoints')
        .addTag('webhooks', 'Webhook endpoints')
        .addTag('admin', 'Admin endpoints')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    const port = process.env.PORT || 3001;
    await app.listen(port);
    console.log(`🚀 SnapGen API running on http://localhost:${port}/api`);
    console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
