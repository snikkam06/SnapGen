import { Module } from '@nestjs/common';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { StorageModule } from '../storage/storage.module';
import { GenerationModule } from '../generation/generation.module';

@Module({
    imports: [StorageModule, GenerationModule],
    controllers: [JobController],
    providers: [JobService],
    exports: [JobService],
})
export class JobModule { }
