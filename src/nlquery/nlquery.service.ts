// src/nlquery/nlquery.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { env } from 'prisma/config';
import 'dotenv/config';

const prisma = new PrismaClient();

@Injectable()
export class NLQueryService {
  private readonly logger = new Logger(NLQueryService.name);

  // Gemini / Google Generative Language API settings (configure in .env)
  private GEMINI_URL = "https://generativelanguage.googleapis.com"; 
  private model = process.env.GEMINI_MODEL ?? env('GEMINI_MODEL') ?? 'gemini-1.0'; // change if needed
  private apiKey = process.env.GEMINI_API_KEY ?? env('GEMINI_API_KEY');

  private httpAgent = new http.Agent({ keepAlive: true, family: 4 });

  // allowed tables/fields map (whitelist)
  private allowed = {
    Blog: [
      'id',
      'title',
      'content',
      'userId',
      'likeCount',
      'createdAt',
      'updatedAt',
    ],
    User: ['id', 'username', 'email', 'createdAt', 'updatedAt'],
    Comment: ['id', 'content', 'userId', 'blogId', 'createdAt'],
    Tag: ['id', 'name', 'blogId', 'createdAt'],
    Like: ['id', 'userId', 'blogId', 'createdAt'],
    Conversation: ['id', 'title', 'isGroup', 'createdAt'],
    Message: ['id', 'content', 'senderId', 'conversationId', 'createdAt'],
  } as Record<string, string[]>;

  // call Gemini to translate NL -> JSON spec
async translateToSpec(nl: string) {
  // Prompt — you can keep full prompt from before
  const prompt = `You are a helpful assistant that translates natural language requests into a JSON "query spec".
Return ONLY valid JSON (no explanation). The JSON must follow this schema exactly:

{
  "action": "select",
  "table": "<TableName>",
  "fields": ["id","title","content"],
  "filters": [ { "field": "user.username", "op": "equals", "value": "Đỗ Đức Anh" } ],
  "limit": 3
}

Rules:
- Only return a SINGLE JSON object exactly following the schema above.
- Allowed ops: equals, contains, in, lt, lte, gt, gte.
- Table names must be one of: Blog, User, Comment, Tag, Like, Conversation, Message.
- Limit must be integer <= 100. If user doesn't specify, default limit=10.
- For nested filters use dot notation (e.g. "user.username").
- Do NOT output SQL, code, or any explanation — only the JSON object.

Input: "${nl}"
Output:`;

  const url = `${this.GEMINI_URL}/v1beta/models/${this.model}:generateContent`;

  // Use same body shape as your working ChatService.chatAi
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    // DO NOT include unknown fields like temperature or maxOutputTokens
  };

  // Use same header style as chatAi
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': this.apiKey ?? '',
  };

  // debug logs (optional, remove in prod)
  this.logger.debug(`Gemini request url=${url}`);
  this.logger.debug(`Gemini request body preview: ${prompt.slice(0, 400)}${prompt.length > 400 ? '...' : ''}`);

  try {
    const resp = await axios.post(url, body, {
      headers,
      timeout: 20000,
      httpAgent: this.httpAgent,
    });

    const data = resp.data;
    let raw = '';

    // robust extraction — same patterns you used elsewhere and in chatAi
    raw =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.outputs?.[0]?.contents?.[0]?.text ??
      data?.results?.[0]?.content ??
      data?.text ??
      data?.response ??
      (typeof data === 'string' ? data : JSON.stringify(data));

    raw = (raw ?? '').toString().trim();
    this.logger.debug('Raw model output preview: ' + raw.slice(0, 1000));

    // try parse directly, else extract first {...}
    try {
      return JSON.parse(raw);
    } catch (err) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e) {
          this.logger.error('Failed parsing JSON after regex extract. Raw output (first 2000 chars): ' + raw.slice(0, 2000));
          throw new Error('Failed to parse JSON spec from model response (extracted substring parse failed).');
        }
      }
      this.logger.error('Failed to parse JSON and no JSON substring found. Raw output (first 2000 chars): ' + raw.slice(0, 2000));
      throw new Error('Failed to parse JSON spec from model response (no JSON found).');
    }
  } catch (err: any) {
    // Log detailed error for debugging (don't print API key)
    if (err?.response) {
      this.logger.error(`Gemini request failed status=${err.response.status} statusText=${err.response.statusText}; responseData=${JSON.stringify(err.response.data).slice(0,2000)}`);
    } else {
      this.logger.error('Gemini request error: ' + (err?.message ?? err));
    }
    throw err;
  }
}


  // validate spec and sanitize
  validateSpec(spec: any) {
    if (!spec || spec.action !== 'select')
      throw new Error('Only select action supported');
    if (!this.allowed[spec.table]) throw new Error('Table not allowed');
    spec.limit = Math.min(Number(spec.limit || 10), 100);
    // fields sanitize
    if (
      !spec.fields ||
      !Array.isArray(spec.fields) ||
      spec.fields.length === 0
    ) {
      // default: return a small set
      spec.fields = ['id', 'title', 'createdAt'].filter((f) =>
        this.allowed[spec.table].includes(f),
      );
    } else {
      spec.fields = spec.fields.filter((f: string) =>
        this.allowed[spec.table].includes(f),
      );
      if (spec.fields.length === 0)
        throw new Error('No allowed fields requested');
    }
    // filters: ensure field exists (allow nested dot only for relations defined)
    if (!Array.isArray(spec.filters)) spec.filters = [];
    spec.filters = spec.filters.filter(
      (f: any) =>
        typeof f.field === 'string' &&
        ['equals', 'contains', 'in', 'lt', 'lte', 'gt', 'gte'].includes(f.op),
    );
    return spec;
  }

  // build Prisma query from spec (supports nested user.username -> relation)
  buildPrismaQuery(spec: any) {
    const where: any = {};
    for (const f of spec.filters) {
      // nested field like "user.username"
      if (f.field.includes('.')) {
        const [rel, sub] = f.field.split('.', 2);
        where[rel] = where[rel] || {};
        if (f.op === 'equals') where[rel][sub] = f.value;
        else if (f.op === 'contains') where[rel][sub] = { contains: f.value, mode: 'insensitive' };
        else if (f.op === 'in') where[rel][sub] = { in: f.value };
        else if (f.op === 'lt') where[rel][sub] = { lt: f.value };
        else if (f.op === 'lte') where[rel][sub] = { lte: f.value };
        else if (f.op === 'gt') where[rel][sub] = { gt: f.value };
        else if (f.op === 'gte') where[rel][sub] = { gte: f.value };
      } else {
        if (f.op === 'equals') where[f.field] = f.value;
        else if (f.op === 'contains') where[f.field] = { contains: f.value, mode: 'insensitive' };
        else if (f.op === 'in') where[f.field] = { in: f.value };
        else if (f.op === 'lt') where[f.field] = { lt: f.value };
        else if (f.op === 'lte') where[f.field] = { lte: f.value };
        else if (f.op === 'gt') where[f.field] = { gt: f.value };
        else if (f.op === 'gte') where[f.field] = { gte: f.value };
      }
    }
    // select mapping
    const select: any = {};
    for (const fld of spec.fields) select[fld] = true;
    return { where, take: spec.limit, select };
  }

  // execute
  async runSpec(spec: any) {
    spec = this.validateSpec(spec);
    const q = this.buildPrismaQuery(spec);

    if (spec.table === 'Blog') {
      // If a filter uses user.*, include the relation in select so we can return it
      if ((spec.filters || []).some((f: any) => f.field.startsWith('user.'))) {
        q.select.user = { select: { username: true, id: true, email: true } };
      }
      // Note: Prisma expects 'select' to be exact shape; ensure q.select exists
      const rows = await prisma.blog.findMany(q);
      return rows;
    }

    // You can add other tables (User, Comment...) with similar mapping
    throw new Error('Table not implemented in server mapping yet');
  }

  // public API
  async queryNaturalLanguage(nl: string) {
    this.logger.log(`NL query: ${nl}`);
    const spec = await this.translateToSpec(nl);
    this.logger.debug('Spec from LLM: ' + JSON.stringify(spec));
    const rows = await this.runSpec(spec);
    const result = { spec, rows };
    console.log('Kết quả:', result);
    return result;
  }
}
