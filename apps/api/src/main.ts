import net from 'node:net';
import { hasRemoteStorageConfig, isProductionRuntime } from '@snapgen/config';
import { loadApiEnv } from './env/load-env';
import { captureApiException, flushApiSentry, initApiSentry } from './observability/sentry';

loadApiEnv();
initApiSentry();
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';

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
        if (isProductionRuntime()) {
            console.error(
                'FATAL: Redis is unavailable. Production API cannot fall back to inline processing.',
            );
            process.exit(1);
        }

        process.env.SNAPGEN_DISABLE_QUEUE = 'true';
        process.env.SNAPGEN_INLINE_PROCESSING = 'true';
        console.warn('Redis is unavailable. Running API with inline media processing.');
    }

    if (isProductionRuntime() && !hasRemoteStorageConfig(process.env)) {
        console.error(
            'FATAL: Cloudflare R2 object storage must be configured in production.',
        );
        process.exit(1);
    }

    const { AppModule } = await import('./app.module');
    const app = await NestFactory.create(AppModule, { rawBody: true });

    // Security headers
    app.use(helmet());

    // Increase body size limit for file uploads (preserve raw body for webhook signature verification)
    app.use(json({
      limit: '50mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }));

    // Global prefix
    app.setGlobalPrefix('api');

    // CORS
    const corsOrigin = process.env.APP_URL;
    if (!corsOrigin && process.env.NODE_ENV === 'production') {
        console.error('FATAL: APP_URL must be set in production');
        process.exit(1);
    }
    app.enableCors({
        origin: corsOrigin || 'http://localhost:3000',
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

    // Swagger (disabled in production)
    if (process.env.NODE_ENV !== 'production') {
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
    }

    const port = process.env.PORT || 3001;
    await app.listen(port);
    console.log(`🚀 SnapGen API running on http://localhost:${port}/api`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
    }
}

bootstrap().catch(async (error) => {
    captureApiException(error, { phase: 'bootstrap' });
    console.error('FATAL: Failed to start API', error);
    await flushApiSentry();
    process.exit(1);
});
