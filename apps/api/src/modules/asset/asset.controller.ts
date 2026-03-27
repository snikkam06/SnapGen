import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { AssetService } from './asset.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('assets')
@Controller('v1/assets')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get()
  @ApiOperation({ summary: 'List assets' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    return this.assetService.findAll(user.clerkUserId, {
      kind,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sort,
    });
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload an asset directly' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsset(
    @CurrentUser() user: AuthUser,
    @Body() body: { durationSec?: string },
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    return this.assetService.uploadAsset(user.clerkUserId, file, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete asset' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assetService.remove(user.clerkUserId, id);
  }
}
