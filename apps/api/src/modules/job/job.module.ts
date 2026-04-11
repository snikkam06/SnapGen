import { Module } from '@nestjs/common';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { GenerationModule } from '../generation/generation.module';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [StorageModule, GenerationModule],
    controllers: [JobController],
    providers: [JobService],
    exports: [JobService],
})
export class JobModule {}
