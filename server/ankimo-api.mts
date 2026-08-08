import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AnkiConnect } from '../src/api/ankiConnect.ts';
import { createTextNote, MEMO_MODEL, QA_MODEL } from '../src/domain/noteWriting.ts';

export const API_HOST = '127.0.0.1';
export const API_PORT = 8787;
export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const MAX_TOKEN_CALLS = 20;
export const MAX_JSON_BODY_BYTES = 256 * 1024;
const DEFAULT_DECK = 'mubu';
const TOKEN_HEADERS = { 'Cache-Control': 'no-store' };

type ApiClient = Pick<AnkiConnect,
  'deckNames' | 'modelFieldNames' | 'addNote' | 'findCards' | 'suspend' | 'areSuspended'>;
type NoteWriter = typeof createTextNote;
type JsonObject = Record<string, unknown>;
type JsonResponse = { status: number; body: JsonObject; headers?: Record<string, string> };
type IdempotencyRecord = { fingerprint: string; result: Promise<JsonResponse> };
type TokenRecord = {
  expiresAt: number;
  calls: number;
  idempotency: Map<string, IdempotencyRecord>;
};

export type AnkimoApiOptions = {
  client?: ApiClient;
  noteWriter?: NoteWriter;
  now?: () => number;
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: { title: 'Ankimo AI API', version: '1.0.0' },
  servers: [{ url: 'https://api.ankimo.yzr-stack.top' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'temporary token' }
    },
    schemas: {
      Tags: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 100 } },
      MemoInput: {
        type: 'object',
        required: ['content', 'idempotencyKey'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 50000, description: 'Short-note text. Whitespace and line breaks are preserved.' },
          tags: { $ref: '#/components/schemas/Tags' },
          idempotencyKey: { type: 'string', minLength: 8, maxLength: 128, description: 'Unique key for this intended write. Reuse only when retrying the identical request.' }
        },
        additionalProperties: false
      },
      QaInput: {
        type: 'object',
        required: ['question', 'answer', 'idempotencyKey'],
        properties: {
          question: { type: 'string', minLength: 1, maxLength: 50000, description: 'Question text. Whitespace and line breaks are preserved.' },
          answer: { type: 'string', minLength: 1, maxLength: 50000, description: 'Answer text. Whitespace and line breaks are preserved.' },
          deck: { type: 'string', minLength: 1, maxLength: 200, default: DEFAULT_DECK, description: 'Exact Anki deck name. Omit to use mubu.' },
          tags: { $ref: '#/components/schemas/Tags' },
          idempotencyKey: { type: 'string', minLength: 8, maxLength: 128, description: 'Unique key for this intended write. Reuse only when retrying the identical request.' }
        },
        additionalProperties: false
      },
      NoteCreated: { type: 'object', required: ['noteId'], properties: { noteId: { type: 'integer' } } },
      DeckList: { type: 'object', required: ['decks'], properties: { decks: { type: 'array', items: { type: 'string' } } } }
    }
  },
  paths: {
    '/v1/decks': {
      get: {
        operationId: 'listDecks',
        summary: 'List exact Anki deck names',
        description: 'Use this before overriding the default mubu deck.',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Available Anki decks', content: { 'application/json': { schema: { $ref: '#/components/schemas/DeckList' } } } } }
      }
    },
    '/v1/memos': {
      post: {
        operationId: 'createMemo',
        summary: 'Create a suspended short note in mubu',
        description: 'Uses model XXHK - 划线 and verifies that every generated card is suspended.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MemoInput' } } } },
        responses: { '200': { description: 'Memo created', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteCreated' } } } } }
      }
    },
    '/v1/qa-cards': {
      post: {
        operationId: 'createQaCard',
        summary: 'Create an active question-and-answer card',
        description: 'Uses model XXHK - 问答 and defaults to the mubu deck.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/QaInput' } } } },
        responses: { '200': { description: 'Question and answer card created', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteCreated' } } } } }
      }
    }
  }
} as const;

function json(status: number, body: JsonObject, headers?: Record<string, string>): JsonResponse {
  return { status, body, headers };
}

function errorResponse(error: unknown): JsonResponse {
  if (error instanceof HttpError) return json(error.status, { error: { code: error.code, message: error.message } });
  return json(500, { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
}

function serviceUnavailable(): JsonResponse {
  return json(503, { error: { code: 'ANKI_OFFLINE', message: 'Anki 或 AnkiConnect 当前不可用' } });
}

function sendJson(response: ServerResponse, result: JsonResponse): void {
  if (response.writableEnded) return;
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...result.headers
  });
  response.end(body);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function contentType(request: IncomingMessage): string {
  return (request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, 'BODY_TOO_LARGE', '请求体不能超过 256 KiB');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, 'BODY_TOO_LARGE', '请求体不能超过 256 KiB');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) throw new HttpError(400, 'INVALID_JSON', '请求体必须是 JSON');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体必须是有效 JSON');
  }
}

function objectBody(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象');
  }
  return value as JsonObject;
}

function onlyFields(body: JsonObject, names: readonly string[]): void {
  if (Object.keys(body).some(name => !names.includes(name))) {
    throw new HttpError(400, 'INVALID_INPUT', '请求包含未定义字段');
  }
}

function textField(body: JsonObject, name: string, maxLength = 50000): string {
  const value = body[name];
  if (typeof value !== 'string' || value.length > maxLength || !value.trim()) {
    throw new HttpError(400, 'INVALID_INPUT', `${name} 必须是非空文本，长度不能超过 ${maxLength}`);
  }
  return value;
}

function optionalTags(body: JsonObject): string[] {
  const value = body.tags;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || value.some(tag => typeof tag !== 'string' || tag.length > 100)) {
    throw new HttpError(400, 'INVALID_INPUT', 'tags 必须是不超过 50 个、单个不超过 100 字符的字符串数组');
  }
  return value;
}

function idempotencyKey(body: JsonObject): string {
  const value = body.idempotencyKey;
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, 'INVALID_INPUT', 'idempotencyKey 长度必须为 8 到 128 个字符');
  }
  return value;
}

function optionalDeck(body: JsonObject): string {
  if (body.deck === undefined) return DEFAULT_DECK;
  if (typeof body.deck !== 'string' || body.deck.length > 200 || !body.deck.trim()) {
    throw new HttpError(400, 'INVALID_INPUT', 'deck 必须是非空文本，长度不能超过 200');
  }
  return body.deck;
}

function bearerToken(request: IncomingMessage, tokens: Map<string, TokenRecord>, now: () => number): TokenRecord {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !/^Bearer \S+$/.test(header)) {
    throw new HttpError(401, 'UNAUTHORIZED', '需要有效的 Bearer Token');
  }
  const token = header.slice('Bearer '.length);
  const tokenHash = hash(token);
  const record = tokens.get(tokenHash);
  const currentTime = now();
  if (!record || record.expiresAt <= currentTime || record.calls >= MAX_TOKEN_CALLS) {
    if (record && record.expiresAt <= currentTime) tokens.delete(tokenHash);
    throw new HttpError(401, 'UNAUTHORIZED', 'Bearer Token 无效、已过期或已达到调用上限');
  }
  record.calls += 1;
  return record;
}

function withIdempotency(record: TokenRecord, key: string, fingerprint: string, action: () => Promise<JsonResponse>): Promise<JsonResponse> {
  const mapKey = hash(key);
  const existing = record.idempotency.get(mapKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '相同 idempotencyKey 已用于不同请求');
    return existing.result;
  }
  const result = Promise.resolve().then(action).catch(errorResponse);
  record.idempotency.set(mapKey, { fingerprint, result });
  return result;
}

function routeMethods(pathname: string): readonly string[] | undefined {
  return {
    '/openapi.json': ['GET'],
    '/health': ['GET'],
    '/api/ai-tokens': ['POST', 'DELETE'],
    '/v1/decks': ['GET'],
    '/v1/memos': ['POST'],
    '/v1/qa-cards': ['POST']
  }[pathname];
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  client: ApiClient,
  noteWriter: NoteWriter,
  tokens: Map<string, TokenRecord>,
  now: () => number
): Promise<void> {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const method = request.method || '';
  const methods = routeMethods(pathname);
  if (!methods) {
    sendJson(response, json(404, { error: { code: 'NOT_FOUND', message: '接口不存在' } }));
    return;
  }
  if (!methods.includes(method)) {
    sendJson(response, json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不被支持' } }, {
      Allow: methods.join(', '),
      ...(pathname === '/api/ai-tokens' ? TOKEN_HEADERS : {})
    }));
    return;
  }

  if (pathname === '/openapi.json') {
    sendJson(response, json(200, OPENAPI_DOCUMENT));
    return;
  }
  if (pathname === '/health') {
    try {
      await client.deckNames();
      sendJson(response, json(200, { status: 'ok' }));
    } catch {
      sendJson(response, serviceUnavailable());
    }
    return;
  }
  if (pathname === '/api/ai-tokens') {
    request.resume();
    if (method === 'DELETE') {
      const revoked = tokens.size;
      tokens.clear();
      sendJson(response, json(200, { revoked }, TOKEN_HEADERS));
      return;
    }
    try {
      const token = `ank_tmp_${randomBytes(32).toString('base64url')}`;
      const expiresAt = now() + TOKEN_TTL_MS;
      tokens.clear();
      tokens.set(hash(token), { expiresAt, calls: 0, idempotency: new Map() });
      sendJson(response, json(200, {
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        maxUses: MAX_TOKEN_CALLS
      }, TOKEN_HEADERS));
    } catch {
      sendJson(response, { ...errorResponse(new Error('token generation failed')), headers: TOKEN_HEADERS });
    }
    return;
  }

  const tokenRecord = bearerToken(request, tokens, now);
  if (pathname === '/v1/decks') {
    try {
      sendJson(response, json(200, { decks: await client.deckNames() }));
    } catch {
      sendJson(response, serviceUnavailable());
    }
    return;
  }

  if (contentType(request) !== 'application/json') {
    request.resume();
    sendJson(response, errorResponse(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须使用 application/json')));
    return;
  }
  const body = objectBody(await readJson(request));
  onlyFields(body, pathname === '/v1/memos'
    ? ['content', 'tags', 'idempotencyKey']
    : ['question', 'answer', 'deck', 'tags', 'idempotencyKey']);
  const tags = optionalTags(body);
  const key = idempotencyKey(body);
  const noteInput = pathname === '/v1/memos'
    ? { deck: DEFAULT_DECK, model: MEMO_MODEL, front: textField(body, 'content'), mode: 'memo' as const, tags }
    : { deck: optionalDeck(body), model: QA_MODEL, front: textField(body, 'question'), back: textField(body, 'answer'), mode: 'qa' as const, tags };
  const fingerprint = hash(JSON.stringify(noteInput));
  const result = await withIdempotency(tokenRecord, key, fingerprint, async () => {
    try {
      const decks = await client.deckNames();
      if (!decks.includes(noteInput.deck)) throw new HttpError(400, 'DECK_NOT_FOUND', `牌组不存在: ${noteInput.deck}`);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return serviceUnavailable();
    }
    try {
      const noteId = await noteWriter(client, noteInput);
      return json(200, { noteId });
    } catch {
      return json(502, { error: { code: 'WRITE_STATUS_UNKNOWN', message: 'Anki 写入失败或状态未知，请勿使用新的 idempotencyKey 重试' } });
    }
  });
  sendJson(response, result);
}

export function createAnkimoApiServer(options: AnkimoApiOptions = {}): Server {
  const client = options.client || new AnkiConnect({ url: process.env.ANKICONNECT_URL || 'http://127.0.0.1:8765' });
  const noteWriter = options.noteWriter || createTextNote;
  const tokens = new Map<string, TokenRecord>();
  const now = options.now || Date.now;
  return createServer((request, response) => {
    void handleRequest(request, response, client, noteWriter, tokens, now).catch(error => sendJson(response, errorResponse(error)));
  });
}

export const openApiDocument = OPENAPI_DOCUMENT;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAnkimoApiServer().listen(API_PORT, API_HOST);
}
