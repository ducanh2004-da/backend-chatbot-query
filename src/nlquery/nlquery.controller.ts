// src/nlquery/nlquery.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { NLQueryService } from './nlquery.service';

@Controller('api/nlquery')
export class NLQueryController {
  constructor(private readonly nl: NLQueryService) {}

  @Post()
  async query(@Body() body: { q: string }) {
    if (!body?.q) return { error: 'No query' };
    try {
      const result = await this.nl.queryNaturalLanguage(body.q);
      // return only rows (and optional sanitized spec)
      return { rows: result.rows, spec: result.spec };
    } catch (err: any) {
      return { error: err.message ?? 'Internal error' };
    }
  }
}
