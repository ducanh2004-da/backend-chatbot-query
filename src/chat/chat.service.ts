// src/chat/chat.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import http from 'http';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  // IMPORTANT: default to 127.0.0.1 (IPv4) to avoid ::1/IPv6 resolution issues
  private OLLAMA_URL = process.env.OLLAMA_URL || ' https://smashing-needed-muskrat.ngrok-free.app/api';

  // Force IPv4 for axios requests
  private httpAgent = new http.Agent({ keepAlive: true, family: 4 });

  async ask(message: string): Promise<{ text: string }> {
    if (!message || typeof message !== 'string') return { text: '' };

    const payload = {
      model: 'gemma3:1b',
      prompt: message,
      stream: false,
    };

    try {
      const resp = await axios.post(
        `${this.OLLAMA_URL}/generate`,
        payload,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30_000,
          httpAgent: this.httpAgent, // <-- force IPv4
        }
      );

      const data = resp.data;
      // Best-effort parse
      if (!data) return { text: '' };
      if (typeof data === 'string') return { text: data };
      if (data.text) return { text: data.text };
      if (data.output) return { text: data.output };
      if (Array.isArray(data.choices) && data.choices[0]) {
        const c = data.choices[0];
        if (typeof c.text === 'string') return { text: c.text };
        if (c.message?.content) return { text: c.message.content };
      }
      return { text: JSON.stringify(data) };
    } catch (err: any) {
      // Log full error for debugging (do NOT expose stack in prod)
      this.logger.error('Ollama request failed', err?.response?.data ?? err?.message ?? err);
      return { text: `Error: failed to generate response (${err?.message ?? 'unknown'})` };
    }
  }
}
