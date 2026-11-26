import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ItemDetailService } from './item-detail.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, ItemDetailService],
  exports: [CatalogService],
})
export class CatalogModule {}
