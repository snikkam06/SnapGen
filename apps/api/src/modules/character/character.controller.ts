import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CharacterService } from './character.service';
import { ClerkAuthGuard } from '../../guards/clerk-auth.guard';
import { CurrentUser, AuthUser } from '../../decorators/current-user.decorator';

@ApiTags('characters')
@Controller('v1/characters')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class CharacterController {
    constructor(private characterService: CharacterService) { }

    @Post()
    @ApiOperation({ summary: 'Create character' })
    async create(
        @CurrentUser() user: AuthUser,
        @Body() body: { name: string; characterType: string },
    ) {
        return this.characterService.create(user.clerkUserId, body);
    }

    @Get()
    @ApiOperation({ summary: 'List characters' })
    async findAll(@CurrentUser() user: AuthUser) {
        return this.characterService.findAll(user.clerkUserId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get character' })
    async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.characterService.findOne(user.clerkUserId, id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update character' })
    async update(
        @CurrentUser() user: AuthUser,
        @Param('id') id: string,
        @Body() body: { name?: string },
    ) {
        return this.characterService.update(user.clerkUserId, id, body);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete character' })
    async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
        return this.characterService.remove(user.clerkUserId, id);
    }

    @Post(':id/dataset/upload-url')
    @ApiOperation({ summary: 'Get signed upload URL for dataset' })
    async getUploadUrl(
        @CurrentUser() user: AuthUser,
        @Param('id') id: string,
        @Body() body: { fileName: string; contentType: string; fileSizeBytes: number },
    ) {
        return this.characterService.getUploadUrl(user.clerkUserId, id, body);
    }

    @Post(':id/train')
    @ApiOperation({ summary: 'Queue model training' })
    async train(
        @CurrentUser() user: AuthUser,
        @Param('id') id: string,
        @Body() body: { trainingPreset: string },
    ) {
        return this.characterService.trainModel(user.clerkUserId, id, body);
    }
}
