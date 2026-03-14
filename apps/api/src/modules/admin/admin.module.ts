import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { GenerationModule } from '../generation/generation.module';

@Module({
  imports: [GenerationModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
