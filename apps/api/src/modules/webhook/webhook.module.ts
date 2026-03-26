import { Module } from '@nestjs/common';
import { GenerationModule } from '../generation/generation.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
    imports: [GenerationModule],
    controllers: [WebhookController],
    providers: [WebhookService],
})
export class WebhookModule { }
