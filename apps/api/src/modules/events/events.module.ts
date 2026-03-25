import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { JobEventsService } from './job-events.service';

@Module({
    controllers: [EventsController],
    providers: [JobEventsService],
    exports: [JobEventsService],
})
export class EventsModule {}
