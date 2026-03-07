import { Controller, Post, Param, Req, Headers, Body, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { Request } from 'express';

@ApiTags('webhooks')
@Controller('v1/webhooks')
export class WebhookController {
    constructor(private webhookService: WebhookService) { }

    @Post('stripe')
    @ApiOperation({ summary: 'Handle Stripe webhooks' })
    async handleStripe(
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string,
    ) {
        const rawBody = req.rawBody;
        if (!rawBody) throw new Error('Missing raw body');
        await this.webhookService.handleStripeWebhook(rawBody, signature);
        return { received: true };
    }

    @Post('provider/:provider')
    @ApiOperation({ summary: 'Handle AI provider webhooks' })
    async handleProvider(
        @Param('provider') provider: string,
        @Body() body: Record<string, unknown>,
    ) {
        await this.webhookService.handleProviderWebhook(provider, body);
        return { received: true };
    }
}
