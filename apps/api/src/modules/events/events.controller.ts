import { Controller, Get, UseGuards, Res, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';
import { Response, Request } from 'express';

@ApiTags('events')
@Controller('v1/events')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class EventsController {
    @Get('jobs/stream')
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

        // Send initial heartbeat
        res.write(`data: ${JSON.stringify({ type: 'connected', userId: user.clerkUserId })}\n\n`);

        // Heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
            res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
        }, 30000);

        // Clean up on disconnect
        req.on('close', () => {
            clearInterval(heartbeat);
            res.end();
        });
    }
}
