import { Module } from '@nestjs/common';
import { SecurityRulesController } from './security-rules.controller';
import { SecurityService } from './security.service';

@Module({
  controllers: [SecurityRulesController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
