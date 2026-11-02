import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClaimsModule } from '../claims/claims.module';
import { SecurityModule } from '../security/security.module';
import { InsuredController, InsuredInviteController } from './insured.controller';
import { InsuredService } from './insured.service';

@Module({
  imports: [AuthModule, ClaimsModule, SecurityModule],
  controllers: [InsuredController, InsuredInviteController],
  providers: [InsuredService],
})
export class InsuredModule {}
