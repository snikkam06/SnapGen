import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [StorageModule],
    controllers: [AssetController],
    providers: [AssetService],
    exports: [AssetService],
})
export class AssetModule { }
