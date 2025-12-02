// src/nlquery/nlquery.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { env } from "prisma/config";
import "dotenv/config";

const prisma = new PrismaClient();

@Injectable()
export class NLQueryService {
  private readonly logger = new Logger(NLQueryService.name);
  private OLLAMA = process.env.AI_URL ?? env("AI_URL");
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

  // call Ollama to translate NL -> JSON spec
  async translateToSpec(nl: string) {
    const prompt = `You are a helpful assistant that translates natural language requests into a JSON "query spec".
Return ONLY valid JSON (no explanation). The JSON must follow this schema:

{
  "action": "select",      // only "select" is allowed
  "table": "<TableName>",  // e.g. "Blog", "User", "Comment"
  "fields": ["id","title","content"], // list of fields to return (optional => all)
  "filters": [             // optional list of filter objects
     { "field": "user.username", "op": "equals", "value": "Đỗ Đức Anh" }
  ],
  "limit": 3               // integer, max 100
}

Rules:
- Only return JSON object exactly following schema.
- Allowed ops: equals, contains, in, lt, lte, gt, gte.
- Table names must be one of: Blog, User, Comment, Tag, Like, Conversation, Message.
- Limit must be integer <= 100. If user doesn't specify, default limit=10.
- For nested filters use dot notation (e.g. "user.username").
- Do NOT output SQL, code, or any explanation — only the JSON object.

Examples:
Input: "Hãy lấy 3 bài blog của tác giả Đỗ Đức Anh"
Output:
{"action":"select","table":"Blog","fields":["id","title","content","createdAt"],"filters":[{"field":"user.username","op":"equals","value":"Đỗ Đức Anh"}],"limit":3}

Input: "Cho tôi 5 bài gần nhất"
Output:
{"action":"select","table":"Blog","fields":["id","title","createdAt"],"filters":[],"limit":5}
`; // use the full prompt template here (see above)
    // For brevity, include the template string content from earlier
    const body = {
      model: 'gemma3:1b',
      prompt: `${prompt}\n\nInput: "${nl}"\nOutput:`,
      stream: false,
    };

    const resp = await axios.post(`${this.OLLAMA}/generate`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
      httpAgent: this.httpAgent,
    });

    // Ollama may return { text: "...json..." } or structured; handle both
    const data = resp.data;
    let raw = '';
    if (typeof data === 'string') raw = data;
    if (typeof data === 'string') {
      raw = data;
    } else if (data.response) {
      raw = data.response;
    } else if (data.text) {
      raw = data.text;
    } else {
      raw = JSON.stringify(data);
    }

    // try to parse JSON out of raw (strip trailing text)
    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      // maybe model returned some prefix/suffix: attempt to extract first {...}
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {}
      }
      throw new Error('Failed to parse JSON spec from model response');
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
        else if (f.op === 'contains') where[rel][sub] = { contains: f.value };
        // add more ops as needed
      } else {
        if (f.op === 'equals') where[f.field] = f.value;
        else if (f.op === 'contains') where[f.field] = { contains: f.value };
        else if (f.op === 'in') where[f.field] = { in: f.value };
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

    // only implement for Blog in example; extend for other tables:
    if (spec.table === 'Blog') {
      // if user relation selected in fields, we need to include user select
      // but since allowed fields didn't include nested 'user.username' as field,
      // we can include user relation if filter used; for simplicity, include user (username) if filter uses it
      if ((spec.filters || []).some((f: any) => f.field.startsWith('user.'))) {
        // ensure select includes user with username
        q.select.user = { select: { username: true, id: true } };
      }
      const rows = await prisma.blog.findMany(q);
      return rows;
    }

    // add other tables similarly...
    throw new Error('Table not implemented in server mapping yet');
  }

  // public API
  async queryNaturalLanguage(nl: string) {
    this.logger.log(`NL query: ${nl}`);
    const spec = await this.translateToSpec(nl);
    this.logger.debug('Spec from LLM: ' + JSON.stringify(spec));
    const rows = await this.runSpec(spec);
    const result = { spec, rows }
    console.log("Keets qua:", result);
    return result;
  }
}
