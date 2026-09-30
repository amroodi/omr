import { Global, Module } from '@nestjs/common';
import { FieldCryptoService } from './field-crypto.service';
import { HashService } from './hash.service';

@Global()
@Module({
  providers: [FieldCryptoService, HashService],
  exports: [FieldCryptoService, HashService],
})
export class CryptoModule {}
