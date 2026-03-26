import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { getRedisConnectionConfig, RATE_LIMITS } from '@snapgen/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { BillingModule } from './modules/billing/billing.module';
import { CharacterModule } from './modules/character/character.module';
import { GenerationModule } from './modules/generation/generation.module';
import { JobModule } from './modules/job/job.module';
import { AssetModule } from './modules/asset/asset.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { AdminModule } from './modules/admin/admin.module';
import { CreditModule } from './modules/credit/credit.module';
import { StorageModule } from './modules/storage/storage.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { SentryExceptionFilter } from './filters/sentry-exception.filter';

@Module({
    imports: [
        ThrottlerModule.forRoot([
            {
                name: 'short',
                ttl: 1000,
                limit: 10,
            },
            {
                name: 'medium',
                ttl: 10000,
                limit: 50,
            },
            {
                name: 'long',
                ttl: RATE_LIMITS.api.ttl * 1000,
                limit: RATE_LIMITS.api.limit,
            },
        ]),
        ...(process.env.SNAPGEN_DISABLE_QUEUE === 'true'
            ? []
            : [
                BullModule.forRoot({
                    connection: getRedisConnectionConfig(process.env.REDIS_URL),
                }),
            ]),
        PrismaModule,
        AuthModule,
        UserModule,
        BillingModule,
        CharacterModule,
        GenerationModule,
        JobModule,
        AssetModule,
        WebhookModule,
        AdminModule,
        CreditModule,
        StorageModule,
        EventsModule,
        HealthModule,
    ],
    providers: [
        {
            provide: APP_FILTER,
            useClass: SentryExceptionFilter,
        },
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule {}
