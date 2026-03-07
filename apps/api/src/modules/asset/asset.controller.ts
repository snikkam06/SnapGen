import { Controller, Get, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AssetService } from './asset.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('assets')
@Controller('v1/assets')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class AssetController {
    constructor(private assetService: AssetService) { }

    @Get()
    @ApiOperation({ summary: 'List assets' })
    async findAll(
        @CurrentUser() user: AuthUser,
        @Query('kind') kind?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.assetService.findAll(user.clerkUserId, {
            kind,
            page: page ? parseInt(page) : undefined,
            limit: limit ? parseInt(limit) : undefined,
        });
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete asset' })
    async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.assetService.remove(user.clerkUserId, id);
    }
}
