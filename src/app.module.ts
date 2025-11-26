import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './chat/chat.module';
import { NlqueryModule } from './nlquery/nlquery.module';

@Module({
  imports: [ChatModule, NlqueryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
