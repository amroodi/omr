import { Global, Module } from '@nestjs/common';
import { AlborzAdapter } from './alborz.adapter';
import { CarrierRegistry } from './carrier.registry';

@Global()
@Module({
  providers: [AlborzAdapter, CarrierRegistry],
  exports: [CarrierRegistry],
})
export class CarriersModule {}
