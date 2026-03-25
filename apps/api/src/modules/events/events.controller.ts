import { Controller, Get, UseGuards, Res, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
    @Throttle({ default: { limit: 5, ttl: 60000 } })
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
            const errorData = JSON.stringify({ type: 'error', message: 'User not found' });
            try {
                res.write(`event: error\ndata: ${errorData}\n\n`);
            } catch {
                // Response already closed
            }
            res.end();
            return;
        }

        let cleaned = false;
        const heartbeat: { current: NodeJS.Timeout | null } = {
            current: null,
        };
        const subscription: { unsubscribe: () => Promise<void> } = {
            unsubscribe: async () => {},
        };

        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (heartbeat.current) {
                clearInterval(heartbeat.current);
            }
            void subscription.unsubscribe();
            if (!res.destroyed) {
                res.end();
            }
        };

        const safeSend = (data: string) => {
            if (res.destroyed) {
                cleanup();
                return;
            }
            try {
                res.write(data);
            } catch {
                cleanup();
            }
        };

        safeSend(`event: connected\ndata: ${JSON.stringify({ type: 'connected', userId: user.clerkUserId })}\n\n`);

        subscription.unsubscribe = await this.jobEvents.subscribeToUserEvents(dbUser.id, (event) => {
            safeSend(`event: job.updated\ndata: ${JSON.stringify(event)}\n\n`);
        });

        heartbeat.current = setInterval(() => {
            safeSend(`event: heartbeat\ndata: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
        }, 30000);

        res.on('error', cleanup);
        req.on('close', cleanup);
    }
}
