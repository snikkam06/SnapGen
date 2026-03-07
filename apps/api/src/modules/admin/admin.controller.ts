import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';

@ApiTags('admin')
@Controller('v1/admin')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class AdminController {
    constructor(private adminService: AdminService) { }

    @Get('users')
    @ApiOperation({ summary: 'Search users' })
    async searchUsers(@Query('q') query: string) {
        return this.adminService.searchUsers(query || '');
    }

    @Get('jobs/failed')
    @ApiOperation({ summary: 'List failed jobs' })
    async getFailedJobs() {
        return this.adminService.getFailedJobs();
    }

    @Post('jobs/:id/retry')
    @ApiOperation({ summary: 'Retry failed job' })
    async retryJob(@Param('id') id: string) {
        return this.adminService.retryJob(id);
    }

    @Post('credits/adjust')
    @ApiOperation({ summary: 'Manual credit adjustment' })
    async adjustCredits(@Body() body: { userId: string; amount: number; reason: string }) {
        return this.adminService.adjustCredits(body.userId, body.amount, body.reason);
    }

    @Get('moderation')
    @ApiOperation({ summary: 'Get moderation queue' })
    async getModerationQueue() {
        return this.adminService.getModerationQueue();
    }

    @Patch('moderation/:id')
    @ApiOperation({ summary: 'Moderate asset' })
    async moderateAsset(
        @Param('id') id: string,
        @Body() body: { status: 'approved' | 'rejected' },
    ) {
        return this.adminService.moderateAsset(id, body.status);
    }
}
