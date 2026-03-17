import { Controller, Get, UseGuards, Res, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { JobEventsService } from './job-events.service';
import { Response, Request } from 'express';

@ApiTags('events')
@Controller('v1/events')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class EventsController {
    constructor(
        private prisma: PrismaService,
        private jobEvents: JobEventsService,
    ) {}

    @Get('jobs/stream')
    @SkipThrottle()
    @ApiOperation({ summary: 'SSE stream for job progress updates' })
    async streamJobUpdates(
        @CurrentUser() user: AuthUser,
        @Res() res: Response,
        @Req() req: Request,
    ) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const dbUser = await this.prisma.user.findUnique({
            where: { clerkUserId: user.clerkUserId },
            select: { id: true },
        });

        if (!dbUser) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'User not found' })}\n\n`);
            res.end();
            return;
        }

        res.write(`data: ${JSON.stringify({ type: 'connected', userId: user.clerkUserId })}\n\n`);

        const heartbeat = setInterval(() => {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
        }, 30000);

        const unsubscribe = await this.jobEvents.subscribeToUserEvents(dbUser.id, (event) => {
            res.write(`event: job.updated\ndata: ${JSON.stringify(event)}\n\n`);
        });

        req.on('close', () => {
            clearInterval(heartbeat);
            void unsubscribe();
            res.end();
        });
    }
}
