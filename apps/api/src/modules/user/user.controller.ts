import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserService } from './user.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('me')
@Controller('v1/me')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class UserController {
    constructor(private userService: UserService) { }

    @Get()
    @ApiOperation({ summary: 'Get current user profile' })
    async getProfile(@CurrentUser() user: AuthUser) {
        return this.userService.getProfile(user.clerkUserId);
    }

    @Patch()
    @ApiOperation({ summary: 'Update profile' })
    async updateProfile(
        @CurrentUser() user: AuthUser,
        @Body() body: { fullName?: string; avatarUrl?: string },
    ) {
        return this.userService.updateProfile(user.clerkUserId, body);
    }
}
