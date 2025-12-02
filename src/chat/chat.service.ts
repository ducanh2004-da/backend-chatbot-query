// src/chat/chat.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import { env } from 'prisma/config';
import 'dotenv/config';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { parseGoogleError } from 'src/common/google-error';

@Injectable()
export class ChatService {
  // private readonly logger = new Logger(ChatService.name);

  // // IMPORTANT: default to 127.0.0.1 (IPv4) to avoid ::1/IPv6 resolution issues
  // private OLLAMA_URL = process.env.AI_URL ?? env("AI_URL");

  // // Force IPv4 for axios requests
  // private httpAgent = new http.Agent({ keepAlive: true, family: 4 });

  // async ask(message: string): Promise<{ text: string }> {
  //   if (!message || typeof message !== 'string') return { text: '' };

  //   const payload = {
  //     model: 'gemma3:1b',
  //     prompt: message,
  //     stream: false,
  //   };

  //   try {
  //     const resp = await axios.post(
  //       `${this.OLLAMA_URL}/generate`,
  //       payload,
  //       {
  //         headers: { 'Content-Type': 'application/json' },
  //         timeout: 30_000,
  //         httpAgent: this.httpAgent, // <-- force IPv4
  //       }
  //     );

  //     const data = resp.data;
  //     // Best-effort parse
  //     if (!data) return { text: '' };
  //     if (typeof data === 'string') return { text: data };
  //     if (data.text) return { text: data.text };
  //     if (data.output) return { text: data.output };
  //     if (Array.isArray(data.choices) && data.choices[0]) {
  //       const c = data.choices[0];
  //       if (typeof c.text === 'string') return { text: c.text };
  //       if (c.message?.content) return { text: c.message.content };
  //     }
  //     return { text: JSON.stringify(data) };
  //   } catch (err: any) {
  //     // Log full error for debugging (do NOT expose stack in prod)
  //     this.logger.error('Ollama request failed', err?.response?.data ?? err?.message ?? err);
  //     return { text: `Error: failed to generate response (${err?.message ?? 'unknown'})` };
  //   }
  // }

  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!this.apiKey) {
      console.warn('GEMINI_API_KEY not set - text generation may fail');
    }
  }

  async chatAi(text: string): Promise<{ text: string; raw: any }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const body = {
      contents: [{ parts: [{ text }] }],
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey,
    };

    try {
      const resp = await firstValueFrom(
        this.httpService.post(url, body, { headers }),
      );

      const json = resp.data;
      let botText = '';
      try {
        botText =
          json?.candidates?.[0]?.content?.parts?.[0]?.text ??
          json?.outputs?.[0]?.contents?.[0]?.text ??
          json?.results?.[0]?.content ??
          JSON.stringify(json).slice(0, 500);
      } catch {
        botText = JSON.stringify(json).slice(0, 500);
      }
      return { text: botText, raw: json };
    } catch (err: any) {
      const parsed = parseGoogleError(err);
      const e: any = new Error(parsed.message);
      e.statusCode = parsed.statusCode || 500;
      if (parsed.retryAfterSeconds)
        e.retryAfterSeconds = parsed.retryAfterSeconds;
      throw e;
    }
  }
}
