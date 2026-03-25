import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMITS } from '@snapgen/config';
import { GenerationService } from './generation.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('generations')
@Controller('v1/generations')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
@Throttle({
  short: { ttl: 1000, limit: RATE_LIMITS.generation.limit },
  medium: { ttl: 10000, limit: RATE_LIMITS.generation.limit },
  long: { ttl: RATE_LIMITS.generation.ttl * 1000, limit: RATE_LIMITS.generation.limit },
})
export class GenerationController {
  constructor(private generationService: GenerationService) {}

  @Post('image')
  @ApiOperation({ summary: 'Generate images' })
  async generateImage(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      characterId?: string;
      stylePackId?: string;
      mode?: 'base' | 'enhanced';
      prompt: string;
      negativePrompt?: string;
      sourceAssetId?: string;
      settings?: Record<string, unknown>;
    },
  ) {
    return this.generationService.createImageJob(user.clerkUserId, body);
  }

  @Post('video')
  @ApiOperation({ summary: 'Generate video' })
  async generateVideo(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      characterId?: string;
      prompt: string;
      sourceAssetId?: string;
      settings?: Record<string, unknown>;
    },
  ) {
    return this.generationService.createVideoJob(user.clerkUserId, body);
  }

  @Post('faceswap-image')
  @ApiOperation({ summary: 'Face swap image' })
  async faceSwapImage(
    @CurrentUser() user: AuthUser,
    @Body() body: { sourceAssetId: string; targetAssetId: string },
  ) {
    return this.generationService.createFaceSwapImageJob(user.clerkUserId, body);
  }

}
