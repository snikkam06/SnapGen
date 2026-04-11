import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GenerationModule } from '../generation/generation.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PrismaModule, GenerationModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
