import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AnkiConnect } from '../src/api/ankiConnect.ts';
import { createTextNote, MEMO_MODEL, QA_MODEL } from '../src/domain/noteWriting.ts';

export const API_HOST = '127.0.0.1';
export const API_PORT = 8787;
export const TOKEN_TTL_MS = 60 * 60 * 1000;
export const CONNECTION_TTL_MS = 10 * 60 * 1000;
export const MAX_TOKEN_CALLS = 100;
export const MAX_TRUSTED_CALLS_PER_MINUTE = 20;
export const MAX_TRUSTED_CALLS_PER_DAY = 200;
export const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_IDEMPOTENCY_RECORDS = 1_000;
const MAX_SEARCH_QUERY_LENGTH = 1_000;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_DECK = 'mubu';
const PUBLIC_API_URL = 'https://ankimo-api.yzr-stack.top';
const OPENAPI_URL = `${PUBLIC_API_URL}/openapi.json`;
const CONNECTION_PREFIX = '/connect/';
const SECRET_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

type ApiClient = Pick<AnkiConnect,
  'deckNames' | 'modelFieldNames' | 'addNote' | 'findCards' | 'findNotes' | 'notesInfo' | 'suspend' | 'areSuspended'>;
type NoteWriter = typeof createTextNote;
type JsonObject = Record<string, unknown>;
type JsonResponse = { status: number; body: JsonObject; headers?: Record<string, string> };
type IdempotencyRecord = { fingerprint: string; result: Promise<JsonResponse> };
type ConnectionRecord = { expiresAt: number };
type AuthRecord = { idempotency: Map<string, IdempotencyRecord> };
type TokenRecord = AuthRecord & {
  expiresAt: number;
  calls: number;
};
type TrustedTokenRecord = AuthRecord & {
  tokenHash: string;
  minuteWindow: number;
  minuteCalls: number;
  dayWindow: number;
  dayCalls: number;
};
type TrustedAccess = { record: TrustedTokenRecord | null; path?: string };

export type AnkimoApiOptions = {
  client?: ApiClient;
  noteWriter?: NoteWriter;
  now?: () => number;
  trustedTokenPath?: string;
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
  info: { title: 'Ankimo AI API', version: '1.2.0' },
  servers: [{ url: PUBLIC_API_URL }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'temporary or trusted token' }
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
      NoteSearchInput: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: MAX_SEARCH_QUERY_LENGTH, description: 'Native Anki search query. Use tag:未浏览 for tags, plain text for content, or a card-embedded index.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, default: DEFAULT_SEARCH_LIMIT },
          offset: { type: 'integer', minimum: 0, default: 0 }
        },
        additionalProperties: false
      },
      NoteInfo: {
        type: 'object',
        required: ['noteId', 'fields'],
        properties: {
          noteId: { type: 'integer' },
          modelName: { type: 'string' },
          fields: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['value'],
              properties: { value: { type: 'string' }, order: { type: 'integer' } }
            }
          },
          tags: { type: 'array', items: { type: 'string' } },
          mod: { type: 'integer' }
        }
      },
      NoteSearchResult: {
        type: 'object',
        required: ['notes', 'total', 'offset', 'limit'],
        properties: {
          notes: { type: 'array', items: { $ref: '#/components/schemas/NoteInfo' } },
          total: { type: 'integer' },
          offset: { type: 'integer' },
          limit: { type: 'integer' }
        }
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
    '/v1/notes/search': {
      post: {
        operationId: 'searchNotes',
        summary: 'Search notes by tag, content, or an embedded index',
        description: 'Passes native Anki search syntax to findNotes, then returns the matching note fields and tags.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteSearchInput' } } } },
        responses: {
          '200': { description: 'Matching notes', content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteSearchResult' } } } },
          '502': { description: 'Anki could not execute the search' }
        }
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

function trustedRecord(tokenHash: string, currentTime: number): TrustedTokenRecord {
  return {
    tokenHash,
    minuteWindow: Math.floor(currentTime / 60_000),
    minuteCalls: 0,
    dayWindow: Math.floor(currentTime / 86_400_000),
    dayCalls: 0,
    idempotency: new Map()
  };
}

function loadTrustedToken(path: string | undefined, currentTime: number): TrustedTokenRecord | null {
  if (!path) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const stored = value as Record<string, unknown>;
      if (stored.version === 1 && typeof stored.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(stored.tokenHash)) {
        return trustedRecord(stored.tokenHash, currentTime);
      }
    }
  } catch {
    // A missing or damaged state file safely means no trusted access.
  }
  return null;
}

function saveTrustedToken(path: string | undefined, tokenHash: string): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, tokenHash })}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

function removeTrustedToken(path: string | undefined): void {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function issueTrustedToken(access: TrustedAccess, now: () => number): string {
  const token = `ank_live_${randomBytes(32).toString('base64url')}`;
  const record = trustedRecord(hash(token), now());
  saveTrustedToken(access.path, record.tokenHash);
  access.record = record;
  return token;
}

function issueToken(tokens: Map<string, TokenRecord>, now: () => number) {
  const token = `ank_tmp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = now() + TOKEN_TTL_MS;
  tokens.clear();
  tokens.set(hash(token), { expiresAt, calls: 0, idempotency: new Map() });
  return { token, expiresAt };
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

function bearerToken(request: IncomingMessage, tokens: Map<string, TokenRecord>, trusted: TrustedAccess, now: () => number): AuthRecord {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !/^Bearer \S+$/.test(header)) {
    throw new HttpError(401, 'UNAUTHORIZED', '需要有效的 Bearer Token');
  }
  const token = header.slice('Bearer '.length);
  const tokenHash = hash(token);
  const record = tokens.get(tokenHash);
  const currentTime = now();
  if (record) {
    if (record.expiresAt <= currentTime || record.calls >= MAX_TOKEN_CALLS) {
      if (record.expiresAt <= currentTime) tokens.delete(tokenHash);
      throw new HttpError(401, 'UNAUTHORIZED', 'Bearer Token 无效、已过期或已达到调用上限');
    }
    record.calls += 1;
    return record;
  }

  const trustedRecord = trusted.record;
  if (!trustedRecord || trustedRecord.tokenHash !== tokenHash) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Bearer Token 无效、已过期或已达到调用上限');
  }
  const minuteWindow = Math.floor(currentTime / 60_000);
  const dayWindow = Math.floor(currentTime / 86_400_000);
  if (trustedRecord.minuteWindow !== minuteWindow) {
    trustedRecord.minuteWindow = minuteWindow;
    trustedRecord.minuteCalls = 0;
  }
  if (trustedRecord.dayWindow !== dayWindow) {
    trustedRecord.dayWindow = dayWindow;
    trustedRecord.dayCalls = 0;
  }
  if (trustedRecord.minuteCalls >= MAX_TRUSTED_CALLS_PER_MINUTE || trustedRecord.dayCalls >= MAX_TRUSTED_CALLS_PER_DAY) {
    throw new HttpError(429, 'RATE_LIMITED', '可信 AI 密钥已达到调用频率上限');
  }
  trustedRecord.minuteCalls += 1;
  trustedRecord.dayCalls += 1;
  return trustedRecord;
}

function withIdempotency(record: AuthRecord, key: string, fingerprint: string, action: () => Promise<JsonResponse>): Promise<JsonResponse> {
  const mapKey = hash(key);
  const existing = record.idempotency.get(mapKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '相同 idempotencyKey 已用于不同请求');
    return existing.result;
  }
  if (record.idempotency.size >= MAX_IDEMPOTENCY_RECORDS) {
    const oldest = record.idempotency.keys().next().value;
    if (oldest) record.idempotency.delete(oldest);
  }
  const result = Promise.resolve().then(action).catch(errorResponse);
  record.idempotency.set(mapKey, { fingerprint, result });
  return result;
}

function connectionCode(pathname: string): string | null {
  if (!pathname.startsWith(CONNECTION_PREFIX)) return null;
  const code = pathname.slice(CONNECTION_PREFIX.length);
  return /^ank_connect_[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}

function routeMethods(pathname: string): readonly string[] | undefined {
  if (connectionCode(pathname)) return ['GET', 'POST'];
  return {
    '/openapi.json': ['GET'],
    '/health': ['GET'],
    '/api/ai-connections': ['POST'],
    '/api/ai-tokens': ['POST', 'DELETE'],
    '/v1/decks': ['GET'],
    '/v1/notes/search': ['POST'],
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
  connections: Map<string, ConnectionRecord>,
  trusted: TrustedAccess,
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
      ...((pathname === '/api/ai-tokens' || pathname === '/api/ai-connections' || connectionCode(pathname)) ? SECRET_HEADERS : {})
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
  if (pathname === '/api/ai-connections') {
    if (contentType(request) !== 'application/json') {
      request.resume();
      sendJson(response, { ...errorResponse(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须使用 application/json')), headers: SECRET_HEADERS });
      return;
    }
    try {
      const body = objectBody(await readJson(request));
      onlyFields(body, []);
    } catch (error) {
      sendJson(response, { ...errorResponse(error), headers: SECRET_HEADERS });
      return;
    }
    try {
      const code = `ank_connect_${randomBytes(32).toString('base64url')}`;
      const expiresAt = now() + CONNECTION_TTL_MS;
      connections.clear();
      connections.set(hash(code), { expiresAt });
      sendJson(response, json(200, {
        connectUrl: `${PUBLIC_API_URL}${CONNECTION_PREFIX}${code}`,
        expiresAt: new Date(expiresAt).toISOString(),
        expiresIn: CONNECTION_TTL_MS / 1000
      }, SECRET_HEADERS));
    } catch {
      sendJson(response, { ...errorResponse(new Error('connection generation failed')), headers: SECRET_HEADERS });
    }
    return;
  }
  if (pathname === '/api/ai-tokens') {
    if (method === 'DELETE') {
      request.resume();
      const revoked = tokens.size;
      const connectionsRevoked = connections.size;
      const trustedRevoked = trusted.record ? 1 : 0;
      tokens.clear();
      connections.clear();
      try {
        removeTrustedToken(trusted.path);
        trusted.record = null;
        sendJson(response, json(200, { revoked, connectionsRevoked, trustedRevoked }, SECRET_HEADERS));
      } catch {
        sendJson(response, { ...errorResponse(new Error('token revocation failed')), headers: SECRET_HEADERS });
      }
      return;
    }
    if (contentType(request) !== 'application/json') {
      request.resume();
      sendJson(response, { ...errorResponse(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须使用 application/json')), headers: SECRET_HEADERS });
      return;
    }
    try {
      const body = objectBody(await readJson(request));
      onlyFields(body, []);
      const token = issueTrustedToken(trusted, now);
      sendJson(response, json(200, {
        token,
        maxCallsPerMinute: MAX_TRUSTED_CALLS_PER_MINUTE,
        maxCallsPerDay: MAX_TRUSTED_CALLS_PER_DAY
      }, SECRET_HEADERS));
    } catch (error) {
      sendJson(response, { ...errorResponse(error), headers: SECRET_HEADERS });
    }
    return;
  }

  const code = connectionCode(pathname);
  if (code) {
    request.resume();
    const codeHash = hash(code);
    const connection = connections.get(codeHash);
    if (!connection || connection.expiresAt <= now()) {
      if (connection) connections.delete(codeHash);
      sendJson(response, json(401, { error: { code: 'INVALID_CONNECTION', message: '连接链接无效或已过期' } }, SECRET_HEADERS));
      return;
    }
    if (method === 'GET') {
      sendJson(response, json(200, {
        type: 'ankimo-ai-connection',
        openapi: OPENAPI_URL,
        exchange: {
          method: 'POST',
          url: `${PUBLIC_API_URL}${pathname}`,
          headers: { 'Content-Type': 'application/json' },
          body: {}
        }
      }, SECRET_HEADERS));
      return;
    }
    if (contentType(request) !== 'application/json') {
      sendJson(response, { ...errorResponse(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '兑换请求必须使用 application/json')), headers: SECRET_HEADERS });
      return;
    }
    connections.delete(codeHash);
    try {
      const { token } = issueToken(tokens, now);
      sendJson(response, json(200, {
        access_token: token,
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_MS / 1000,
        max_uses: MAX_TOKEN_CALLS,
        openapi: OPENAPI_URL
      }, SECRET_HEADERS));
    } catch {
      sendJson(response, { ...errorResponse(new Error('token generation failed')), headers: SECRET_HEADERS });
    }
    return;
  }

  const tokenRecord = bearerToken(request, tokens, trusted, now);
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
  if (pathname === '/v1/notes/search') {
    onlyFields(body, ['query', 'limit', 'offset']);
    const query = textField(body, 'query', MAX_SEARCH_QUERY_LENGTH);
    const limit = body.limit ?? DEFAULT_SEARCH_LIMIT;
    const offset = body.offset ?? 0;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new HttpError(400, 'INVALID_INPUT', `limit 必须是 1 到 ${MAX_SEARCH_LIMIT} 的整数`);
    }
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      throw new HttpError(400, 'INVALID_INPUT', 'offset 必须是非负整数');
    }
    try {
      const noteIds = [...new Set(await client.findNotes(query))].reverse();
      const pageIds = noteIds.slice(offset, offset + limit);
      const found = pageIds.length ? await client.notesInfo(pageIds) : [];
      const byId = new Map(found.map(note => [note.noteId, note]));
      const notes = pageIds.flatMap(noteId => {
        const note = byId.get(noteId);
        return note ? [note] : [];
      });
      sendJson(response, json(200, { notes, total: noteIds.length, offset, limit }));
    } catch {
      sendJson(response, json(502, { error: { code: 'ANKI_SEARCH_FAILED', message: 'Anki 无法执行搜索，请检查查询语法和连接状态' } }));
    }
    return;
  }
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
  const connections = new Map<string, ConnectionRecord>();
  const now = options.now || Date.now;
  const trusted: TrustedAccess = {
    record: loadTrustedToken(options.trustedTokenPath, now()),
    path: options.trustedTokenPath
  };
  return createServer((request, response) => {
    void handleRequest(request, response, client, noteWriter, tokens, connections, trusted, now).catch(error => sendJson(response, errorResponse(error)));
  });
}

export const openApiDocument = OPENAPI_DOCUMENT;

if (process.argv.includes('--serve')) {
  createAnkimoApiServer({ trustedTokenPath: join(homedir(), 'Library', 'Application Support', 'Ankimo', 'trusted-ai-key.json') }).listen(API_PORT, API_HOST);
}
