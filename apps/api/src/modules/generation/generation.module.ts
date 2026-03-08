import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [
        StorageModule,
        ...(process.env.SNAPGEN_DISABLE_QUEUE === 'true'
            ? []
            : [BullModule.registerQueue({ name: 'image-generation' })]),
    ],
    controllers: [GenerationController],
    providers: [GenerationService],
    exports: [GenerationService],
})
export class GenerationModule { }
