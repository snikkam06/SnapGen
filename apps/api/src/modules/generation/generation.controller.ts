import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GenerationService } from './generation.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('generations')
@Controller('v1/generations')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
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

  @Post('upscale')
  @ApiOperation({ summary: 'Upscale image' })
  async upscale(@CurrentUser() user: AuthUser, @Body() body: { assetId: string; mode?: string }) {
    return this.generationService.createUpscaleJob(user.clerkUserId, body);
  }
}
