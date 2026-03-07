import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JobService } from './job.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('jobs')
@Controller('v1/jobs')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class JobController {
    constructor(private jobService: JobService) { }

    @Get()
    @ApiOperation({ summary: 'List jobs' })
    async findAll(
        @CurrentUser() user: AuthUser,
        @Query('status') status?: string,
        @Query('jobType') jobType?: string,
    ) {
        return this.jobService.findAll(user.clerkUserId, { status, jobType });
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get job detail' })
    async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.jobService.findOne(user.clerkUserId, id);
    }
}
