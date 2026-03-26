import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { QueueHealthService } from './queue-health.service';
import { StorageModule } from '../storage/storage.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    StorageModule,
    EventsModule,
    ...(process.env.SNAPGEN_DISABLE_QUEUE === 'true'
      ? []
      : [
          BullModule.registerQueue(
            { name: 'image-generation' },
            { name: 'video-generation' },
            { name: 'faceswap-generation' },
            { name: 'image-poll' },
            { name: 'video-poll' },
            { name: 'faceswap-poll' },
          ),
        ]),
  ],
  controllers: [GenerationController],
  providers: [GenerationService, QueueHealthService],
  exports: [GenerationService, QueueHealthService],
})
export class GenerationModule {}
