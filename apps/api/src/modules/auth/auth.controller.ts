import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('sync')
    @UseGuards(ClerkAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Sync user after frontend login' })
    async sync(@CurrentUser() user: AuthUser) {
        return this.authService.syncUser(user.clerkUserId);
    }
}
