import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('billing')
@Controller('v1/billing')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class BillingController {
    constructor(private billingService: BillingService) { }

    @Post('checkout-session')
    @ApiOperation({ summary: 'Create Stripe checkout session' })
    async createCheckoutSession(
        @CurrentUser() user: AuthUser,
        @Body() body: { planCode: string },
    ) {
        return this.billingService.createCheckoutSession(user.clerkUserId, body.planCode);
    }

    @Post('portal-session')
    @ApiOperation({ summary: 'Create Stripe billing portal session' })
    async createPortalSession(@CurrentUser() user: AuthUser) {
        return this.billingService.createPortalSession(user.clerkUserId);
    }

    @Get('credits')
    @ApiOperation({ summary: 'Get credit balance and history' })
    async getCredits(@CurrentUser() user: AuthUser) {
        return this.billingService.getCredits(user.clerkUserId);
    }
}
