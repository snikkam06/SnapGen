import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { WebhookService } from './webhook.service';
import { Request } from 'express';

const ALLOWED_PROVIDERS = new Set(['fal', 'replicate']);

@ApiTags('webhooks')
@SkipThrottle()
@Controller('v1/webhooks')
export class WebhookController {
  constructor(private webhookService: WebhookService) {}

  @Post('stripe')
  @ApiOperation({ summary: 'Handle Stripe webhooks' })
  async handleStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) throw new BadRequestException('Missing raw body');
    if (!signature) throw new BadRequestException('Missing Stripe signature');
    try {
      await this.webhookService.handleStripeWebhook(rawBody, signature);
      return { received: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Stripe webhook error:', message, error instanceof Error ? error.stack : '');
      throw error;
    }
  }

  @Post('provider/:provider')
  @ApiOperation({ summary: 'Handle AI provider webhooks' })
  async handleProvider(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
  ) {
    if (!ALLOWED_PROVIDERS.has(provider)) {
      throw new BadRequestException(`Unknown provider: ${provider}`);
    }
    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException('Missing raw body');
    await this.webhookService.handleProviderWebhook(provider, body, {
      rawBody,
      headers: req.headers,
    });
    return { received: true };
  }
}
