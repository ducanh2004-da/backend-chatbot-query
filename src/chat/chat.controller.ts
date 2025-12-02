// src/chat/chat.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('api/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async chat(@Body() body: { message?: string }) {
    const message = body?.message ?? '';
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return { text: '' };
    }

    try {
      const result = await this.chatService.chatAi(message);
      // ensure we return predictable shape
      return { text: result?.text ?? '' };
    } catch (err) {
      this.logger.error('Controller error', err);
      // don't expose stack to client in production
      return { text: 'Internal server error' };
    }
  }
}
