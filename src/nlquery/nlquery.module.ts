import { Module } from '@nestjs/common';
import { NLQueryService } from './nlquery.service';
import { NLQueryController } from './nlquery.controller';

@Module({
  providers: [NLQueryService],
  controllers: [NLQueryController]
})
export class NlqueryModule {}
