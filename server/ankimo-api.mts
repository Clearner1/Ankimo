import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnkiConnect, AnkiConnectActionError } from '../src/api/ankiConnect.ts';
import { buildNoteFields, createTextNote, MEMO_MODEL, noteTextToHtml, QA_MODEL } from '../src/domain/noteWriting.ts';

export const API_HOST = '127.0.0.1';
export const API_PORT = 8787;
export const TOKEN_TTL_MS = 60 * 60 * 1000;
export const CONNECTION_TTL_MS = 10 * 60 * 1000;
export const MAX_TOKEN_CALLS = 100;
export const MAX_TRUSTED_CALLS_PER_MINUTE = 20;
export const MAX_TRUSTED_CALLS_PER_DAY = 200;
export const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_CAPTURE_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CAPTURE_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_IDEMPOTENCY_RECORDS = 1_000;
const MAX_SEARCH_QUERY_LENGTH = 1_000;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_DECK = 'mubu';
const CAPTURE_DECK = 'Ankimo';
const CAPTURE_RETRY_DELAYS_MS = [15_000, 60_000] as const;
const CAPTURE_PROXY_MARKER = 'X-Ankimo-Client-Verified';
const CAPTURE_WORKER_RETRY_MS = 1_000;
const PUBLIC_API_URL = 'https://ankimo-api.yzr-stack.top';
const OPENAPI_URL = `${PUBLIC_API_URL}/openapi.json`;
const CONNECTION_PREFIX = '/connect/';
const SECRET_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

type ApiClient = Pick<AnkiConnect,
  'deckNames' | 'modelFieldNames' | 'addNote' | 'findCards' | 'findNotes' | 'notesInfo' | 'suspend' | 'areSuspended' | 'storeMediaFileBase64'> &
  Partial<Pick<AnkiConnect, 'createDeck'>>;
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

type CaptureMode = 'memo' | 'qa';
type CaptureStatus = 'queued' | 'preparing' | 'writing' | 'synced' | 'needs_attention';
type CapturePayload = {
  mode: CaptureMode;
  front: string;
  back?: string;
  tags: string[];
  audioFilename?: string;
  audioSha256?: string;
};
type CaptureRecord = CapturePayload & {
  captureId: string;
  fingerprint: string;
  status: CaptureStatus;
  noteId: number | null;
  errorCode: string | null;
  attemptCount: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  transcript: string | null;
  transcriptionStarted: boolean;
};
type CaptureInput = { captureId: string; payload: CapturePayload; audioData?: Buffer };
type AudioTranscriber = (path: string) => Promise<string>;

export type AnkimoApiOptions = {
  client?: ApiClient;
  noteWriter?: NoteWriter;
  now?: () => number;
  trustedTokenPath?: string;
  outboxPath?: string;
  captureMediaPath?: string;
  captureRetryDelaysMs?: readonly number[];
  transcribeAudio?: AudioTranscriber;
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
  info: { title: 'Ankimo AI API', version: '1.2.1' },
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
          query: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
            description: 'Native Anki search query. Use tag:未浏览 for tags, plain text for content, a card-embedded index, or nid:1234567890 for an exact note ID lookup.',
            examples: ['tag:未浏览', 'OpenAI', 'ankimo-aihot-card-1', 'nid:1234567890']
          },
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
        description: 'Passes native Anki search syntax to findNotes, then returns the matching note fields and tags. Use nid:<noteId> here instead of inventing a separate note-by-ID endpoint.',
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

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function transcribeWithTypeless(path: string): Promise<string> {
  const script = join(homedir(), '.codex', 'skills', 'typeless-transcribe', 'scripts', 'transcribe.js');
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, path],
      { encoding: 'utf8', timeout: 70_000, maxBuffer: 128 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(
            /login|account configuration/i.test(stderr) ? 'TYPELESS_LOGIN_REQUIRED' : 'TYPELESS_FAILED'
          ));
          return;
        }
        const text = stdout.trim();
        if (!text || text.length > 50_000) {
          reject(new Error('TYPELESS_INVALID_RESULT'));
          return;
        }
        resolve(text);
      }
    );
  });
}

function isDatabaseBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errcode?: unknown; errstr?: unknown };
  return candidate.code === 'SQLITE_BUSY' || candidate.errcode === 5 || candidate.errstr === 'database is locked';
}

function captureModel(mode: CaptureMode): string {
  return mode === 'memo' ? MEMO_MODEL : QA_MODEL;
}

function captureMediaFilename(record: CaptureRecord): string {
  return `ankimo-${record.captureId}.m4a`;
}

function captureFrontHtml(record: CaptureRecord): string {
  const text = [record.front.trim() ? record.front : '', record.transcript || '']
    .filter(Boolean)
    .join('\n\n');
  const html = noteTextToHtml(text);
  return record.audioFilename ? `${html}<br>[sound:${captureMediaFilename(record)}]` : html;
}

function firstFieldValue(note: Awaited<ReturnType<ApiClient['notesInfo']>>[number]): string | null {
  const fields = Object.values(note.fields).sort((left, right) => {
    const leftOrder = typeof left === 'string' ? Number.MAX_SAFE_INTEGER : left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right === 'string' ? Number.MAX_SAFE_INTEGER : right.order ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
  const first = fields[0];
  return first === undefined ? null : typeof first === 'string' ? first : first.value;
}

function capturePayloadJson(payload: CapturePayload): string {
  return JSON.stringify({
    mode: payload.mode,
    front: payload.front,
    back: payload.mode === 'qa' ? payload.back || '' : undefined,
    tags: payload.tags,
    audioSha256: payload.audioSha256
  });
}

function captureFingerprint(payload: CapturePayload): string {
  return hash(capturePayloadJson(payload));
}

function captureRow(row: Record<string, unknown>): CaptureRecord {
  return {
    captureId: String(row.capture_id),
    fingerprint: String(row.fingerprint),
    mode: row.mode as CaptureMode,
    front: String(row.front),
    ...(row.back === null ? {} : { back: String(row.back) }),
    tags: JSON.parse(String(row.tags_json)) as string[],
    ...(row.audio_filename === null ? {} : { audioFilename: String(row.audio_filename) }),
    ...(row.audio_sha256 === null ? {} : { audioSha256: String(row.audio_sha256) }),
    status: row.status as CaptureStatus,
    noteId: row.note_id === null ? null : Number(row.note_id),
    errorCode: row.error_code === null ? null : String(row.error_code),
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: Number(row.next_attempt_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    transcript: row.transcript === null ? null : String(row.transcript),
    transcriptionStarted: Number(row.transcription_started) === 1
  };
}

class CaptureStore {
  private readonly db: DatabaseSync;
  private readonly mediaPath: string | null;
  private readonly now: () => number;

  constructor(path: string, mediaPath: string | null, now: () => number) {
    this.now = now;
    this.mediaPath = mediaPath;
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(path), 0o700);
    }
    if (mediaPath) {
      mkdirSync(mediaPath, { recursive: true, mode: 0o700 });
      chmodSync(mediaPath, 0o700);
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS captures (
        capture_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('memo', 'qa')),
        front TEXT NOT NULL,
        back TEXT,
        tags_json TEXT NOT NULL,
        audio_filename TEXT,
        audio_sha256 TEXT,
        transcript TEXT,
        transcription_started INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'writing', 'synced', 'needs_attention')),
        note_id INTEGER,
        error_code TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS captures_queue_idx ON captures (status, next_attempt_at, created_at);
    `);
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(captures)').all() as { name: string }[]).map(column => column.name)
    );
    if (!columns.has('audio_filename')) this.db.exec('ALTER TABLE captures ADD COLUMN audio_filename TEXT');
    if (!columns.has('audio_sha256')) this.db.exec('ALTER TABLE captures ADD COLUMN audio_sha256 TEXT');
    if (!columns.has('transcript')) this.db.exec('ALTER TABLE captures ADD COLUMN transcript TEXT');
    if (!columns.has('transcription_started')) {
      this.db.exec('ALTER TABLE captures ADD COLUMN transcription_started INTEGER NOT NULL DEFAULT 0');
    }
    this.recover();
  }

  private recover(): void {
    const currentTime = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        UPDATE captures
        SET status = 'needs_attention', error_code = 'TRANSCRIPTION_STATUS_UNKNOWN', updated_at = ?
        WHERE status = 'preparing' AND transcription_started = 1
      `).run(currentTime);
      this.db.prepare(`
        UPDATE captures
        SET status = 'queued', next_attempt_at = ?, updated_at = ?
        WHERE status IN ('queued', 'preparing')
      `).run(currentTime, currentTime);
      this.db.prepare(`
        UPDATE captures
        SET status = 'queued', next_attempt_at = ?, error_code = 'READBACK_PENDING', updated_at = ?
        WHERE status = 'writing' AND note_id IS NOT NULL AND audio_filename IS NOT NULL
      `).run(currentTime, currentTime);
      this.db.prepare(`
        UPDATE captures
        SET status = 'needs_attention', error_code = 'WRITE_STATUS_UNKNOWN', updated_at = ?
        WHERE status = 'writing'
      `).run(currentTime);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  get(captureId: string): CaptureRecord | null {
    const row = this.db.prepare('SELECT * FROM captures WHERE capture_id = ?').get(captureId) as Record<string, unknown> | undefined;
    return row ? captureRow(row) : null;
  }

  accept({ captureId, payload, audioData }: CaptureInput): CaptureRecord {
    const fingerprint = captureFingerprint(payload);
    const currentTime = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existingRow = this.db.prepare('SELECT * FROM captures WHERE capture_id = ?').get(captureId) as Record<string, unknown> | undefined;
      if (existingRow) {
        const existing = captureRow(existingRow);
        if (existing.fingerprint !== fingerprint) {
          throw new HttpError(409, 'CAPTURE_CONFLICT', '相同 captureId 已用于不同内容');
        }
        this.db.exec('COMMIT');
        return existing;
      }
      if (payload.audioFilename) {
        if (!audioData || !payload.audioSha256 || hash(audioData) !== payload.audioSha256) {
          throw new HttpError(400, 'INVALID_AUDIO', '录音内容无效');
        }
        const path = this.audioPath(payload.audioFilename);
        const temporaryPath = `${path}.${randomBytes(6).toString('hex')}.tmp`;
        writeFileSync(temporaryPath, audioData, { mode: 0o600 });
        renameSync(temporaryPath, path);
        chmodSync(path, 0o600);
      }
      this.db.prepare(`
        INSERT INTO captures (
          capture_id, fingerprint, mode, front, back, tags_json, audio_filename,
          audio_sha256, transcript, transcription_started, status, note_id,
          error_code, attempt_count, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'queued', NULL, NULL, 0, ?, ?, ?)
      `).run(
        captureId,
        fingerprint,
        payload.mode,
        payload.front,
        payload.back ?? null,
        JSON.stringify(payload.tags),
        payload.audioFilename ?? null,
        payload.audioSha256 ?? null,
        currentTime,
        currentTime,
        currentTime
      );
      this.db.exec('COMMIT');
      const record = this.get(captureId);
      if (!record) throw new Error('capture commit succeeded but row is missing');
      return record;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
      throw error;
    }
  }

  audioPath(filename: string): string {
    if (!this.mediaPath || !/^[0-9a-f-]{36}\.m4a$/i.test(filename)) {
      throw new HttpError(500, 'AUDIO_STORE_UNAVAILABLE', '录音存储不可用');
    }
    return join(this.mediaPath, filename);
  }

  claimNext(currentTime: number): CaptureRecord | null {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`
        SELECT * FROM captures
        WHERE status = 'queued'
        ORDER BY created_at ASC, capture_id ASC
        LIMIT 1
      `).get() as Record<string, unknown> | undefined;
      if (!row || Number(row.next_attempt_at) > currentTime) {
        this.db.exec('COMMIT');
        return null;
      }
      const attemptCount = Number(row.attempt_count) + 1;
      const result = this.db.prepare(`
        UPDATE captures
        SET status = 'preparing', attempt_count = ?, error_code = NULL, updated_at = ?
        WHERE capture_id = ? AND status = 'queued'
      `).run(attemptCount, currentTime, String(row.capture_id));
      if (Number(result.changes) !== 1) {
        this.db.exec('COMMIT');
        return null;
      }
      this.db.exec('COMMIT');
      return captureRow({ ...row, status: 'preparing', attempt_count: attemptCount, error_code: null, updated_at: currentTime });
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
      if (isDatabaseBusy(error)) return null;
      throw error;
    }
  }

  nextAttemptAt(): number | null {
    const row = this.db.prepare(`
      SELECT next_attempt_at FROM captures
      WHERE status = 'queued'
      ORDER BY created_at ASC, capture_id ASC
      LIMIT 1
    `).get() as { next_attempt_at?: number } | undefined;
    return row?.next_attempt_at === undefined ? null : Number(row.next_attempt_at);
  }

  update(captureId: string, values: Partial<Pick<CaptureRecord, 'status' | 'noteId' | 'errorCode' | 'attemptCount' | 'nextAttemptAt'>>): void {
    const columns: string[] = [];
    const parameters: (number | string | null)[] = [];
    const set = (column: string, value: number | string | null) => {
      columns.push(`${column} = ?`);
      parameters.push(value);
    };
    if (values.status !== undefined) set('status', values.status);
    if (values.noteId !== undefined) set('note_id', values.noteId);
    if (values.errorCode !== undefined) set('error_code', values.errorCode);
    if (values.attemptCount !== undefined) set('attempt_count', values.attemptCount);
    if (values.nextAttemptAt !== undefined) set('next_attempt_at', values.nextAttemptAt);
    if (!columns.length) return;
    set('updated_at', this.now());
    parameters.push(captureId);
    this.db.prepare(`UPDATE captures SET ${columns.join(', ')} WHERE capture_id = ?`).run(...parameters);
  }

  startTranscription(captureId: string): void {
    this.db.prepare(`
      UPDATE captures
      SET transcription_started = 1, error_code = NULL, updated_at = ?
      WHERE capture_id = ? AND status = 'preparing' AND transcript IS NULL
    `).run(this.now(), captureId);
  }

  saveTranscript(captureId: string, transcript: string): void {
    this.db.prepare(`
      UPDATE captures
      SET transcript = ?, transcription_started = 0, updated_at = ?
      WHERE capture_id = ?
    `).run(transcript, this.now(), captureId);
  }

  retryTranscription(captureId: string): CaptureRecord {
    const record = this.get(captureId);
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Capture 不存在');
    if (!record.audioFilename || record.status !== 'needs_attention' || ![
      'TYPELESS_FAILED',
      'TYPELESS_LOGIN_REQUIRED',
      'TYPELESS_INVALID_RESULT',
      'TRANSCRIPTION_STATUS_UNKNOWN'
    ].includes(record.errorCode || '')) {
      throw new HttpError(409, 'RETRY_NOT_SAFE', '这个 Capture 不能安全地重新转录');
    }
    this.db.prepare(`
      UPDATE captures
      SET status = 'queued', error_code = NULL, transcription_started = 0,
          next_attempt_at = ?, updated_at = ?
      WHERE capture_id = ?
    `).run(this.now(), this.now(), captureId);
    const updated = this.get(captureId);
    if (!updated) throw new Error('capture retry update failed');
    return updated;
  }

  removeAudio(record: CaptureRecord): void {
    if (!record.audioFilename) return;
    try {
      unlinkSync(this.audioPath(record.audioFilename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  markSynced(captureId: string, noteId: number): void {
    this.db.prepare(`
      UPDATE captures
      SET status = 'synced', note_id = ?, error_code = NULL,
          front = '', back = NULL, tags_json = '[]', audio_filename = NULL,
          audio_sha256 = NULL, transcript = NULL, transcription_started = 0,
          updated_at = ?
      WHERE capture_id = ?
    `).run(noteId, this.now(), captureId);
  }

  close(): void {
    this.db.close();
  }
}

class PermanentCaptureError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

class CaptureWorker {
  private closed = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly store: CaptureStore;
  private readonly client: ApiClient;
  private readonly now: () => number;
  private readonly retryDelaysMs: readonly number[];
  private readonly transcribeAudio: AudioTranscriber;

  constructor(
    store: CaptureStore,
    client: ApiClient,
    now: () => number,
    retryDelaysMs: readonly number[],
    transcribeAudio: AudioTranscriber
  ) {
    this.store = store;
    this.client = client;
    this.now = now;
    this.retryDelaysMs = retryDelaysMs;
    this.transcribeAudio = transcribeAudio;
    this.wake();
  }

  wake(): void {
    if (this.closed || this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, 0);
    this.timer.unref?.();
  }

  private scheduleNext(): void {
    if (this.closed || this.running || this.timer) return;
    const next = this.store.nextAttemptAt();
    if (next === null) return;
    const delay = Math.max(0, next - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
    this.timer.unref?.();
  }

  private scheduleRecovery(): void {
    if (this.closed || this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, CAPTURE_WORKER_RETRY_MS);
    this.timer.unref?.();
  }

  private recordWorkerError(error: unknown): void {
    if (this.closed) return;
    console.error(`Capture worker stopped: ${isDatabaseBusy(error) ? 'SQLITE_BUSY' : 'WORKER_ERROR'}`);
  }

  private async run(): Promise<void> {
    if (this.closed || this.running) return;
    this.running = true;
    try {
      while (!this.closed) {
        const record = this.store.claimNext(this.now());
        if (!record) break;
        await this.process(record);
      }
    } catch (error) {
      this.recordWorkerError(error);
    } finally {
      this.running = false;
      try {
        this.scheduleNext();
      } catch (error) {
        this.recordWorkerError(error);
        this.scheduleRecovery();
      }
    }
  }

  private async process(record: CaptureRecord): Promise<void> {
    const attemptCount = record.attemptCount;
    try {
      let current = record;
      if (current.audioFilename && !current.transcript && current.noteId === null) {
        this.store.startTranscription(current.captureId);
        let transcript: string;
        try {
          transcript = await this.transcribeAudio(this.store.audioPath(current.audioFilename));
        } catch (error) {
          if (this.closed) return;
          const code = error instanceof Error && [
            'TYPELESS_LOGIN_REQUIRED',
            'TYPELESS_INVALID_RESULT'
          ].includes(error.message) ? error.message : 'TYPELESS_FAILED';
          this.store.update(current.captureId, { status: 'needs_attention', errorCode: code });
          return;
        }
        if (this.closed) return;
        this.store.saveTranscript(current.captureId, transcript);
        current = this.store.get(current.captureId) || current;
      }
      if (current.audioFilename && !current.transcript) {
        throw new PermanentCaptureError('TYPELESS_INVALID_RESULT');
      }
      if (current.audioFilename && current.noteId !== null) {
        await this.confirmAudioNote(current, current.noteId);
        this.store.removeAudio(current);
        this.store.markSynced(current.captureId, current.noteId);
        return;
      }

      const decks = await this.client.deckNames();
      if (!decks.includes(CAPTURE_DECK)) {
        if (!this.client.createDeck) throw new PermanentCaptureError('DECK_NOT_FOUND');
        await this.client.createDeck(CAPTURE_DECK);
      }
      const model = captureModel(record.mode);
      let fieldNames: string[];
      try { fieldNames = await this.client.modelFieldNames(model); }
      catch (error) {
        if (error instanceof AnkiConnectActionError) throw new PermanentCaptureError('MODEL_INVALID');
        throw error;
      }
      if (fieldNames.length < (record.mode === 'qa' ? 2 : 1)) {
        throw new PermanentCaptureError('MODEL_INVALID');
      }
      if (current.audioFilename) {
        const filename = captureMediaFilename(current);
        let stored: string | false | null;
        try {
          stored = await this.client.storeMediaFileBase64(
            filename,
            readFileSync(this.store.audioPath(current.audioFilename)).toString('base64')
          );
        } catch (error) {
          if (error instanceof AnkiConnectActionError) throw new PermanentCaptureError('MEDIA_WRITE_FAILED');
          throw error;
        }
        if (stored !== filename) throw new PermanentCaptureError('MEDIA_WRITE_FAILED');
      }
      if (this.closed) return;
      this.store.update(current.captureId, { status: 'writing' });
      const noteId = await this.client.addNote(
        CAPTURE_DECK,
        model,
        buildNoteFields(
          fieldNames,
          captureFrontHtml(current),
          noteTextToHtml(current.back || ''),
          current.mode
        ),
        current.tags
      );
      if (this.closed) return;
      if (typeof noteId !== 'number' || !Number.isSafeInteger(noteId) || noteId <= 0) {
        this.store.update(current.captureId, { status: 'needs_attention', errorCode: 'WRITE_STATUS_UNKNOWN' });
        return;
      }
      this.store.update(current.captureId, { status: 'writing', noteId });
      if (current.audioFilename) {
        current = this.store.get(current.captureId) || { ...current, noteId };
        await this.confirmAudioNote(current, noteId);
        this.store.removeAudio(current);
      }
      this.store.markSynced(current.captureId, noteId);
    } catch (error) {
      if (this.closed) return;
      if (error instanceof PermanentCaptureError) {
        this.store.update(record.captureId, { status: 'needs_attention', errorCode: error.code });
        return;
      }
      const latest = this.store.get(record.captureId);
      if (latest?.status === 'writing' && latest.audioFilename && latest.noteId !== null) {
        const delays = this.retryDelaysMs.length ? this.retryDelaysMs : CAPTURE_RETRY_DELAYS_MS;
        this.store.update(record.captureId, {
          status: 'queued',
          errorCode: 'READBACK_PENDING',
          nextAttemptAt: this.now() + delays[0]
        });
        return;
      }
      if (latest?.status === 'writing') {
        this.store.update(record.captureId, { status: 'needs_attention', errorCode: 'WRITE_STATUS_UNKNOWN' });
        return;
      }
      const delays = this.retryDelaysMs.length ? this.retryDelaysMs : CAPTURE_RETRY_DELAYS_MS;
      const delay = delays[Math.min(attemptCount - 1, delays.length - 1)];
      this.store.update(record.captureId, {
        status: 'queued',
        errorCode: 'ANKI_OFFLINE',
        nextAttemptAt: this.now() + delay
      });
    }
  }

  private async confirmAudioNote(record: CaptureRecord, noteId: number): Promise<void> {
    const note = (await this.client.notesInfo([noteId]))[0];
    if (!note || firstFieldValue(note) !== captureFrontHtml(record)) {
      throw new PermanentCaptureError('READBACK_MISMATCH');
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
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

async function readJson(request: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    request.resume();
    throw new HttpError(413, 'BODY_TOO_LARGE', `请求体不能超过 ${Math.floor(maxBytes / 1024)} KiB`);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      request.resume();
      throw new HttpError(413, 'BODY_TOO_LARGE', `请求体不能超过 ${Math.floor(maxBytes / 1024)} KiB`);
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

function capturePath(pathname: string): 'collection' | string | null {
  if (pathname === '/api/captures') return 'collection';
  const match = /^\/api\/captures\/([^/]+)$/.exec(pathname);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1])) return null;
  return match[1].toLowerCase();
}

function captureRetryPath(pathname: string): string | null {
  const match = /^\/api\/captures\/([^/]+)\/retry-transcription$/.exec(pathname);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1])) return null;
  return match[1].toLowerCase();
}

function isCaptureRequest(pathname: string): boolean {
  return pathname === '/api/captures' || pathname.startsWith('/api/captures/');
}

function captureErrorResponse(error: unknown): JsonResponse {
  return { ...errorResponse(error), headers: SECRET_HEADERS };
}

function hasVerifiedCaptureClient(request: IncomingMessage): boolean {
  return request.headers[CAPTURE_PROXY_MARKER.toLowerCase()] === '1';
}

function capturePayload(body: JsonObject): CaptureInput {
  onlyFields(body, ['captureId', 'mode', 'front', 'back', 'tags', 'audio']);
  const captureId = body.captureId;
  if (typeof captureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId)) {
    throw new HttpError(400, 'INVALID_INPUT', 'captureId 必须是 UUID');
  }
  const mode = body.mode;
  if (mode !== 'memo' && mode !== 'qa') throw new HttpError(400, 'INVALID_INPUT', 'mode 必须是 memo 或 qa');
  const normalizedCaptureId = captureId.toLowerCase();
  let audioData: Buffer | undefined;
  let audioFilename: string | undefined;
  let audioSha256: string | undefined;
  if (body.audio !== undefined) {
    if (mode !== 'memo') throw new HttpError(400, 'INVALID_INPUT', '录音只支持 memo 模式');
    const audio = objectBody(body.audio);
    onlyFields(audio, ['format', 'data']);
    if (audio.format !== 'm4a' || typeof audio.data !== 'string' || !audio.data.length ||
        audio.data.length > Math.ceil(MAX_CAPTURE_AUDIO_BYTES * 4 / 3) + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data)) {
      throw new HttpError(400, 'INVALID_AUDIO', '录音必须是有效的 m4a Base64 数据');
    }
    audioData = Buffer.from(audio.data, 'base64');
    if (!audioData.length || audioData.length > MAX_CAPTURE_AUDIO_BYTES ||
        audioData.toString('base64').replace(/=+$/, '') !== audio.data.replace(/=+$/, '')) {
      throw new HttpError(400, 'INVALID_AUDIO', '录音必须是有效的 m4a Base64 数据');
    }
    audioFilename = `${normalizedCaptureId}.m4a`;
    audioSha256 = hash(audioData);
  }
  const rawFront = body.front;
  if (typeof rawFront !== 'string' || rawFront.length > 50_000 || (!rawFront.trim() && !audioData)) {
    throw new HttpError(400, 'INVALID_INPUT', 'front 必须是非空文本，纯录音时可以为空');
  }
  const front = rawFront;
  const rawBack = body.back;
  if (rawBack !== undefined && (typeof rawBack !== 'string' || rawBack.length > 50000)) {
    throw new HttpError(400, 'INVALID_INPUT', 'back 必须是长度不超过 50000 的文本');
  }
  const back = typeof rawBack === 'string' ? rawBack : undefined;
  if (mode === 'memo' && rawBack !== undefined) throw new HttpError(400, 'INVALID_INPUT', 'memo 模式不能包含 back');
  if (mode === 'qa' && (!back || !back.trim())) throw new HttpError(400, 'INVALID_INPUT', 'qa 模式需要 back');
  const tags = optionalTags(body);
  return {
    captureId: normalizedCaptureId,
    payload: {
      mode,
      front,
      ...(mode === 'qa' ? { back: back || '' } : {}),
      tags,
      ...(audioFilename ? { audioFilename, audioSha256 } : {})
    },
    ...(audioData ? { audioData } : {})
  };
}

function captureResponse(record: CaptureRecord): JsonResponse {
  const body: JsonObject = {
    captureId: record.captureId,
    status: record.status
  };
  if (record.noteId !== null) body.noteId = record.noteId;
  if (record.errorCode) body.errorCode = record.errorCode;
  return json(record.status === 'queued' || record.status === 'preparing' || record.status === 'writing' ? 202 : 200, body, SECRET_HEADERS);
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
  if (captureRetryPath(pathname)) return ['POST'];
  const capture = capturePath(pathname);
  if (capture === 'collection') return ['POST'];
  if (capture) return ['GET'];
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
  captures: CaptureStore,
  captureWorker: CaptureWorker,
  now: () => number
): Promise<void> {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const method = request.method || '';
  const captureRequest = isCaptureRequest(pathname);
  const methods = routeMethods(pathname);
  if (!methods) {
    sendJson(response, json(404, { error: { code: 'NOT_FOUND', message: '接口不存在' } }, captureRequest ? SECRET_HEADERS : undefined));
    return;
  }
  if (!methods.includes(method)) {
    sendJson(response, json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不被支持' } }, {
      Allow: methods.join(', '),
      ...((captureRequest || pathname === '/api/ai-tokens' || pathname === '/api/ai-connections' || connectionCode(pathname)) ? SECRET_HEADERS : {})
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

  const retryCapture = captureRetryPath(pathname);
  if (retryCapture) {
    request.resume();
    if (!hasVerifiedCaptureClient(request)) {
      sendJson(response, json(403, { error: { code: 'CLIENT_NOT_VERIFIED', message: '客户端身份未通过代理验证' } }, SECRET_HEADERS));
      return;
    }
    try {
      const record = captures.retryTranscription(retryCapture);
      captureWorker.wake();
      sendJson(response, captureResponse(record));
    } catch (error) {
      sendJson(response, captureErrorResponse(error));
    }
    return;
  }

  const capture = capturePath(pathname);
  if (capture === 'collection') {
    if (!hasVerifiedCaptureClient(request)) {
      request.resume();
      sendJson(response, json(403, { error: { code: 'CLIENT_NOT_VERIFIED', message: '客户端身份未通过代理验证' } }, SECRET_HEADERS));
      return;
    }
    if (contentType(request) !== 'application/json') {
      request.resume();
      sendJson(response, captureErrorResponse(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须使用 application/json')));
      return;
    }
    try {
      // ponytail: one bounded JSON file keeps background upload atomic; use multipart only if real recordings outgrow 6 MiB.
      const body = objectBody(await readJson(request, MAX_CAPTURE_BODY_BYTES));
      const parsed = capturePayload(body);
      const record = captures.accept(parsed);
      captureWorker.wake();
      sendJson(response, captureResponse(record));
    } catch (error) {
      sendJson(response, captureErrorResponse(error));
    }
    return;
  }
  if (capture) {
    if (!hasVerifiedCaptureClient(request)) {
      request.resume();
      sendJson(response, json(403, { error: { code: 'CLIENT_NOT_VERIFIED', message: '客户端身份未通过代理验证' } }, SECRET_HEADERS));
      return;
    }
    try {
      const record = captures.get(capture);
      if (!record) {
        sendJson(response, json(404, { error: { code: 'NOT_FOUND', message: 'Capture 不存在' } }, SECRET_HEADERS));
        return;
      }
      sendJson(response, captureResponse(record));
    } catch (error) {
      sendJson(response, captureErrorResponse(error));
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
  const captures = new CaptureStore(options.outboxPath || ':memory:', options.captureMediaPath || null, now);
  const captureWorker = new CaptureWorker(
    captures,
    client,
    now,
    options.captureRetryDelaysMs || CAPTURE_RETRY_DELAYS_MS,
    options.transcribeAudio || transcribeWithTypeless
  );
  const trusted: TrustedAccess = {
    record: loadTrustedToken(options.trustedTokenPath, now()),
    path: options.trustedTokenPath
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response, client, noteWriter, tokens, connections, trusted, captures, captureWorker, now).catch(error => sendJson(response, errorResponse(error)));
  });
  server.once('close', () => {
    captureWorker.close();
    captures.close();
  });
  return server;
}

export const openApiDocument = OPENAPI_DOCUMENT;

if (process.argv.includes('--serve')) {
  process.umask(0o077);
  const applicationSupport = join(homedir(), 'Library', 'Application Support', 'Ankimo');
  createAnkimoApiServer({
    outboxPath: join(applicationSupport, 'outbox.sqlite3'),
    captureMediaPath: join(applicationSupport, 'capture-audio'),
    trustedTokenPath: join(applicationSupport, 'trusted-ai-key.json')
  }).listen(API_PORT, API_HOST);
}
