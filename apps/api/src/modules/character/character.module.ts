import { Module } from '@nestjs/common';
import { CharacterController } from './character.controller';
import { CharacterService } from './character.service';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [StorageModule],
    controllers: [CharacterController],
    providers: [CharacterService],
    exports: [CharacterService],
})
export class CharacterModule { }
