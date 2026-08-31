import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnkiConnectActionError, AnkiConnectTransportError, type NoteInfo } from '../src/api/ankiConnect';
import { CONNECTION_TTL_MS, createAnkimoApiServer, MAX_TOKEN_CALLS, MAX_TRUSTED_CALLS_PER_DAY, MAX_TRUSTED_CALLS_PER_MINUTE, TOKEN_TTL_MS, type AnkimoApiOptions } from './ankimo-api.mts';

type FakeAnki = {
  deckNames: () => Promise<string[]>;
  createDeck: (deck: string) => Promise<string>;
  modelFieldNames: (model: string) => Promise<string[]>;
  addNote: (deck: string, model: string, fields: Record<string, string>, tags?: string[]) => Promise<number>;
  findCards: (query: string) => Promise<number[]>;
  findNotes: (query: string) => Promise<number[]>;
  notesInfo: (notes: number[]) => Promise<NoteInfo[]>;
  storeMediaFileBase64: (filename: string, data: string) => Promise<string | false | null>;
  suspend: (cards: number[]) => Promise<null>;
  areSuspended: (cards: number[]) => Promise<boolean[]>;
};

const servers: ReturnType<typeof createAnkimoApiServer>[] = [];
const tempDirs: string[] = [];

function fakeAnki(overrides: Partial<FakeAnki> = {}): FakeAnki {
  return {
    deckNames: async () => ['mubu', 'other'],
    createDeck: async deck => deck,
    modelFieldNames: async model => model === 'XXHK - 问答' ? ['问题', '答案', '引用'] : ['引用'],
    addNote: async () => 101,
    findCards: async () => [201],
    findNotes: async () => [],
    notesInfo: async notes => notes.map(noteId => ({
      noteId,
      modelName: 'XXHK - 问答',
      fields: { 问题: { value: `note ${noteId}`, order: 0 } },
      tags: []
    })),
    storeMediaFileBase64: async filename => filename,
    suspend: async () => null,
    areSuspended: async () => [true],
    ...overrides
  };
}

async function start(options: AnkimoApiOptions = {}) {
  const server = createAnkimoApiServer(options);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function startWithServer(options: AnkimoApiOptions = {}) {
  const base = await start(options);
  const server = servers[servers.length - 1];
  if (!server) throw new Error('test server was not recorded');
  return { base, server };
}

async function request(base: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  return { response, body: await response.json() as Record<string, unknown> };
}

async function stop(server: ReturnType<typeof createAnkimoApiServer>): Promise<void> {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  await new Promise<void>(resolve => server.close(() => resolve()));
}

function captureAuth(_token: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ankimo-Client-Verified': '1' },
    body: JSON.stringify(body)
  };
}

async function capture(base: string, token: string, body: unknown) {
  return request(base, '/api/captures', captureAuth(token, body));
}

async function captureStatus(base: string, _token: string, captureId: string) {
  return request(base, `/api/captures/${captureId}`, {
    headers: { 'X-Ankimo-Client-Verified': '1' }
  });
}

async function waitForCaptureStatus(base: string, token: string, captureId: string, status: string): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await captureStatus(base, token, captureId);
    last = result.body;
    if (result.body.status === status) return result.body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`capture ${captureId} did not reach ${status}: ${JSON.stringify(last)}`);
}

async function trustedToken(base: string): Promise<string> {
  const { response, body } = await request(base, '/api/ai-tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  expect(response.status).toBe(200);
  expect(body.maxCallsPerMinute).toBe(MAX_TRUSTED_CALLS_PER_MINUTE);
  expect(body.maxCallsPerDay).toBe(MAX_TRUSTED_CALLS_PER_DAY);
  if (typeof body.token !== 'string') throw new Error('token response missing token');
  return body.token;
}

async function temporaryToken(base: string): Promise<string> {
  const connection = await request(base, '/api/ai-connections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  const exchanged = await request(base, new URL(String(connection.body.connectUrl)).pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  if (typeof exchanged.body.access_token !== 'string') throw new Error('temporary token response missing token');
  return exchanged.body.access_token;
}

function auth(tokenValue: string, body?: unknown): RequestInit {
  return {
    headers: { Authorization: `Bearer ${tokenValue}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Ankimo HTTP API', () => {
  it('previews and atomically exchanges a one-time AI connection', async () => {
    const base = await start({ client: fakeAnki(), now: () => 1_000_000 });
    const created = await request(base, '/api/ai-connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    expect(created.response.status).toBe(200);
    expect(created.response.headers.get('cache-control')).toBe('no-store');
    expect(created.body.expiresIn).toBe(CONNECTION_TTL_MS / 1000);
    const connectUrl = String(created.body.connectUrl);
    const connectPath = new URL(connectUrl).pathname;

    const preview = await request(base, connectPath);
    expect(preview.response.status).toBe(200);
    expect(preview.response.headers.get('cache-control')).toBe('no-store');
    expect(preview.response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(preview.body).toMatchObject({
      type: 'ankimo-ai-connection',
      openapi: 'https://ankimo-api.yzr-stack.top/openapi.json',
      exchange: { method: 'POST', url: connectUrl }
    });
    expect(JSON.stringify(preview.body)).not.toContain('ank_tmp_');
    expect((await request(base, connectPath)).response.status).toBe(200);

    expect((await request(base, connectPath, { method: 'POST' })).response.status).toBe(415);
    const exchangeRequest = {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    };
    const exchanges = await Promise.all([
      request(base, connectPath, exchangeRequest),
      request(base, connectPath, exchangeRequest)
    ]);
    expect(exchanges.map(result => result.response.status).sort()).toEqual([200, 401]);
    const exchanged = exchanges.find(result => result.response.status === 200);
    expect(exchanged?.response.headers.get('cache-control')).toBe('no-store');
    expect(exchanged?.body).toMatchObject({
      token_type: 'Bearer', expires_in: TOKEN_TTL_MS / 1000, max_uses: MAX_TOKEN_CALLS,
      openapi: 'https://ankimo-api.yzr-stack.top/openapi.json'
    });
    const accessToken = exchanged?.body.access_token;
    expect(typeof accessToken).toBe('string');
    const authorized = await request(base, '/v1/decks', {
      headers: { Authorization: `Bearer ${String(accessToken)}` }
    });
    expect(authorized.response.status).toBe(200);
  });

  it('replaces old AI connections and rejects expired links', async () => {
    let currentTime = 1_000_000;
    const base = await start({ client: fakeAnki(), now: () => currentTime });
    const createConnection = async () => {
      const result = await request(base, '/api/ai-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      return new URL(String(result.body.connectUrl)).pathname;
    };
    const replaced = await createConnection();
    const expiring = await createConnection();
    expect((await request(base, replaced, { method: 'POST' })).response.status).toBe(401);
    currentTime += CONNECTION_TTL_MS + 1;
    expect((await request(base, expiring)).response.status).toBe(401);
  });

  it('revokes bearer tokens and pending AI connections together', async () => {
    const base = await start({ client: fakeAnki() });
    const connection = await request(base, '/api/ai-connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const connectPath = new URL(String(connection.body.connectUrl)).pathname;
    const bearer = await trustedToken(base);

    const revoked = await request(base, '/api/ai-tokens', { method: 'DELETE' });
    expect(revoked.response.status).toBe(200);
    expect(revoked.body).toMatchObject({ revoked: 0, connectionsRevoked: 1, trustedRevoked: 1 });
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${bearer}` } })).response.status).toBe(401);
    expect((await request(base, connectPath, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    })).response.status).toBe(401);
  });

  it('limits bearer calls and expires tokens', async () => {
    let currentTime = 1_000_000;
    const base = await start({ client: fakeAnki(), now: () => currentTime });
    const replaced = await temporaryToken(base);
    const bearer = await temporaryToken(base);
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${replaced}` } })).response.status).toBe(401);

    for (let call = 0; call < MAX_TOKEN_CALLS; call++) {
      const result = await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${bearer}` } });
      expect(result.response.status).toBe(200);
    }
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${bearer}` } })).response.status).toBe(401);

    const expiring = await temporaryToken(base);
    currentTime += TOKEN_TTL_MS + 1;
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${expiring}` } })).response.status).toBe(401);
  });

  it('persists only a trusted token hash and revokes it across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-api-test-'));
    tempDirs.push(dir);
    const trustedTokenPath = join(dir, 'trusted.json');
    const first = await start({ client: fakeAnki(), trustedTokenPath });
    const original = await trustedToken(first);
    expect(readFileSync(trustedTokenPath, 'utf8')).not.toContain(original);
    expect(statSync(trustedTokenPath).mode & 0o777).toBe(0o600);

    const restarted = await start({ client: fakeAnki(), trustedTokenPath });
    expect((await request(restarted, '/v1/decks', { headers: { Authorization: `Bearer ${original}` } })).response.status).toBe(200);
    const replacement = await trustedToken(restarted);
    expect((await request(restarted, '/v1/decks', { headers: { Authorization: `Bearer ${original}` } })).response.status).toBe(401);
    expect((await request(restarted, '/v1/decks', { headers: { Authorization: `Bearer ${replacement}` } })).response.status).toBe(200);

    expect((await request(restarted, '/api/ai-tokens', { method: 'DELETE' })).response.status).toBe(200);
    const afterRevocation = await start({ client: fakeAnki(), trustedTokenPath });
    expect((await request(afterRevocation, '/v1/decks', { headers: { Authorization: `Bearer ${replacement}` } })).response.status).toBe(401);
  });

  it('rate limits trusted tokens per minute and per day', async () => {
    let currentTime = 1_000_000;
    const base = await start({ client: fakeAnki(), now: () => currentTime });
    const bearer = await trustedToken(base);
    const call = () => request(base, '/v1/decks', { headers: { Authorization: `Bearer ${bearer}` } });

    for (let count = 0; count < MAX_TRUSTED_CALLS_PER_MINUTE; count++) expect((await call()).response.status).toBe(200);
    expect((await call()).response.status).toBe(429);
    for (let batch = 1; batch < MAX_TRUSTED_CALLS_PER_DAY / MAX_TRUSTED_CALLS_PER_MINUTE; batch++) {
      currentTime += 60_000;
      for (let count = 0; count < MAX_TRUSTED_CALLS_PER_MINUTE; count++) expect((await call()).response.status).toBe(200);
    }
    currentTime += 60_000;
    expect((await call()).response.status).toBe(429);
    currentTime += 86_400_000;
    expect((await call()).response.status).toBe(200);
  });

  it('creates memo and QA cards with the mubu default and uses shared memo suspension', async () => {
    const calls: { deck: string; model: string; fields: Record<string, string>; suspended: number[][] } = {
      deck: '', model: '', fields: {}, suspended: []
    };
    const client = fakeAnki({
      addNote: async (deck, model, fields) => { calls.deck = deck; calls.model = model; calls.fields = fields; return 301; },
      suspend: async cards => { calls.suspended.push(cards); return null; }
    });
    const base = await start({ client });
    const bearer = await trustedToken(base);

    const memo = await request(base, '/v1/memos', auth(bearer, { content: '原始  笔记', idempotencyKey: 'memo-key-1', tags: ['ai'] }));
    expect(memo.response.status).toBe(200);
    expect(calls.deck).toBe('mubu');
    expect(calls.model).toBe('XXHK - 划线');
    expect(calls.fields['引用']).toContain('原始  笔记');
    expect(calls.suspended).toEqual([[201]]);

    const qa = await request(base, '/v1/qa-cards', auth(bearer, {
      question: '问题', answer: '答案', idempotencyKey: 'qa-key-1'
    }));
    expect(qa.response.status).toBe(200);
    expect(calls.deck).toBe('mubu');
    expect(calls.model).toBe('XXHK - 问答');
  });

  it('keeps the first idempotent result and rejects a different payload', async () => {
    let writes = 0;
    const base = await start({ client: fakeAnki({ addNote: async () => { writes++; throw new Error('write status unknown'); } }) });
    const bearer = await trustedToken(base);
    const body = { content: '一次写入', idempotencyKey: 'same-key-1' };
    const first = await request(base, '/v1/memos', auth(bearer, body));
    const second = await request(base, '/v1/memos', auth(bearer, body));
    const conflict = await request(base, '/v1/memos', auth(bearer, { ...body, content: '不同内容' }));

    expect(first.response.status).toBe(502);
    expect(second.response.status).toBe(502);
    expect(second.body).toEqual(first.body);
    expect(conflict.response.status).toBe(409);
    expect(writes).toBe(1);
  });

  it('searches notes with native Anki queries and paginates newest first', async () => {
    const queries: string[] = [];
    const infoCalls: number[][] = [];
    const base = await start({ client: fakeAnki({
      findNotes: async query => {
        queries.push(query);
        if (query === 'tag:未浏览') return [101, 102, 102, 103];
        if (query === 'ankimo-aihot-card-1') return [102];
        return [];
      },
      notesInfo: async notes => {
        infoCalls.push(notes);
        return [...notes].reverse().map(noteId => ({
          noteId,
          modelName: 'XXHK - 问答',
          fields: { 问题: { value: `note ${noteId}`, order: 0 } },
          tags: ['未浏览']
        }));
      }
    }) });
    const bearer = await trustedToken(base);

    const tagged = await request(base, '/v1/notes/search', auth(bearer, {
      query: 'tag:未浏览', limit: 2, offset: 1
    }));
    expect(tagged.response.status).toBe(200);
    expect(tagged.body).toMatchObject({
      total: 3,
      offset: 1,
      limit: 2,
      notes: [{ noteId: 102 }, { noteId: 101 }]
    });

    const indexed = await request(base, '/v1/notes/search', auth(bearer, { query: 'ankimo-aihot-card-1' }));
    expect(indexed.body).toMatchObject({ total: 1, offset: 0, limit: 30, notes: [{ noteId: 102 }] });

    const missing = await request(base, '/v1/notes/search', auth(bearer, { query: '没有结果' }));
    expect(missing.body).toEqual({ notes: [], total: 0, offset: 0, limit: 30 });
    expect(queries).toEqual(['tag:未浏览', 'ankimo-aihot-card-1', '没有结果']);
    expect(infoCalls).toEqual([[102, 101], [102]]);
  });

  it('returns 202 after SQLite commit without waiting for Anki', async () => {
    let release: ((noteId: number) => void) | undefined;
    const addNote = () => new Promise<number>(resolve => { release = resolve; });
    const base = await start({ client: fakeAnki({
      deckNames: async () => ['Ankimo'],
      addNote
    }) });
    const bearer = await trustedToken(base);
    const captureId = '00000000-0000-4000-8000-000000000001';
    const unverified = await request(base, '/api/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captureId, mode: 'memo', front: '拒绝', tags: [] })
    });
    expect(unverified.response.status).toBe(403);
    expect(unverified.response.headers.get('cache-control')).toBe('no-store');

    const memoBack = await capture(base, bearer, { captureId, mode: 'memo', front: '正文', back: '不允许', tags: [] });
    expect(memoBack.response.status).toBe(400);
    expect(memoBack.response.headers.get('cache-control')).toBe('no-store');

    const created = await capture(base, bearer, {
      captureId, mode: 'memo', front: '立即返回', tags: []
    });

    expect(created.response.status).toBe(202);
    expect(created.response.headers.get('cache-control')).toBe('no-store');
    expect(created.body).toMatchObject({ captureId });
    expect(['queued', 'preparing', 'writing']).toContain(created.body.status);

    await new Promise(resolve => setTimeout(resolve, 10));
    release?.(901);
    const synced = await waitForCaptureStatus(base, bearer, captureId, 'synced');
    expect(synced).toMatchObject({ captureId, status: 'synced', noteId: 901 });
    expect((await captureStatus(base, bearer, captureId)).response.headers.get('cache-control')).toBe('no-store');
    const missing = await captureStatus(base, bearer, '00000000-0000-4000-8000-000000000099');
    expect(missing.response.status).toBe(404);
    expect(missing.response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps durable capture idempotency and rejects a different payload', async () => {
    let release: ((noteId: number) => void) | undefined;
    let writes = 0;
    const addNote = () => {
      writes += 1;
      return new Promise<number>(resolve => { release = resolve; });
    };
    const base = await start({ client: fakeAnki({ deckNames: async () => ['Ankimo'], addNote }) });
    const bearer = await trustedToken(base);
    const body = { captureId: '00000000-0000-4000-8000-000000000002', mode: 'memo', front: '只写一次', tags: ['a'] };
    const first = await capture(base, bearer, body);
    const duplicate = await capture(base, bearer, body);
    const conflict = await capture(base, bearer, { ...body, front: '不同内容' });

    expect(first.response.status).toBe(202);
    expect(duplicate.response.status).toBe(202);
    expect(duplicate.body).toMatchObject({ captureId: body.captureId, status: expect.any(String) });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: 'CAPTURE_CONFLICT' } });
    await waitForCaptureStatus(base, bearer, body.captureId, 'writing');
    for (let attempt = 0; attempt < 30 && !release; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (!release) throw new Error('addNote release was not registered');
    release?.(902);
    await waitForCaptureStatus(base, bearer, body.captureId, 'synced');
    expect(writes).toBe(1);
  });

  it('claims a shared queued capture atomically across two workers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-capture-test-'));
    tempDirs.push(dir);
    const outboxPath = join(dir, 'outbox.sqlite3');
    let writes = 0;
    const client = fakeAnki({
      deckNames: async () => ['Ankimo'],
      addNote: async () => {
        writes += 1;
        await new Promise(resolve => setTimeout(resolve, 30));
        return 907;
      }
    });
    const first = await startWithServer({ outboxPath, client });
    const second = await startWithServer({ outboxPath, client });
    const captureId = '00000000-0000-4000-8000-000000000007';
    await Promise.all([
      capture(first.base, '', { captureId, mode: 'memo', front: '共享队列', tags: [] }),
      capture(second.base, '', { captureId, mode: 'memo', front: '共享队列', tags: [] })
    ]);

    const synced = await waitForCaptureStatus(first.base, '', captureId, 'synced');
    expect(synced.noteId).toBe(907);
    expect(writes).toBe(1);
  });

  it('moves deterministic model failures to needs_attention', async () => {
    let writes = 0;
    const base = await start({ client: fakeAnki({
      deckNames: async () => ['Ankimo'],
      modelFieldNames: async () => { throw new AnkiConnectActionError('model does not exist'); },
      addNote: async () => { writes += 1; return 908; }
    }) });
    const captureId = '00000000-0000-4000-8000-000000000008';
    await capture(base, '', { captureId, mode: 'memo', front: '模板错误', tags: [] });
    const attention = await waitForCaptureStatus(base, '', captureId, 'needs_attention');
    expect(attention).toMatchObject({ status: 'needs_attention', errorCode: 'MODEL_INVALID' });
    expect(writes).toBe(0);
  });

  it('keeps model lookup transport failures queued for retry', async () => {
    const base = await start({ captureRetryDelaysMs: [60_000], client: fakeAnki({
      deckNames: async () => ['Ankimo'],
      modelFieldNames: async () => { throw new AnkiConnectTransportError('Anki offline'); }
    }) });
    const captureId = '00000000-0000-4000-8000-00000000000a';
    await capture(base, '', { captureId, mode: 'memo', front: '稍后重试', tags: [] });
    let queued: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 50; attempt += 1) {
      queued = (await captureStatus(base, '', captureId)).body;
      if (queued.errorCode === 'ANKI_OFFLINE') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(queued).toMatchObject({ captureId, status: 'queued', errorCode: 'ANKI_OFFLINE' });
  });

  it('clears synced payload while retaining its fingerprint tombstone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-capture-test-'));
    tempDirs.push(dir);
    const outboxPath = join(dir, 'outbox.sqlite3');
    const base = await start({ outboxPath, client: fakeAnki({
      deckNames: async () => ['Ankimo'],
      addNote: async () => 909
    }) });
    const bearer = '';
    const body = { captureId: '00000000-0000-4000-8000-000000000009', mode: 'qa', front: '问题', back: '答案', tags: ['tag'] };
    await capture(base, bearer, body);
    await waitForCaptureStatus(base, bearer, body.captureId, 'synced');

    const db = new DatabaseSync(outboxPath);
    const row = db.prepare('SELECT fingerprint, front, back, tags_json, note_id FROM captures WHERE capture_id = ?').get(body.captureId) as Record<string, unknown>;
    db.close();
    expect(row).toMatchObject({ front: '', back: null, tags_json: '[]', note_id: 909 });
    expect(typeof row.fingerprint).toBe('string');

    const duplicate = await capture(base, bearer, body);
    const conflict = await capture(base, bearer, { ...body, front: '不同问题' });
    expect(duplicate.body).toMatchObject({ status: 'synced', noteId: 909 });
    expect(conflict.response.status).toBe(409);
  });

  it('recovers a queued capture after restart and writes fixed native fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-capture-test-'));
    tempDirs.push(dir);
    const outboxPath = join(dir, 'outbox.sqlite3');
    const offline = fakeAnki({ deckNames: async () => { throw new Error('offline'); } });
    const first = await startWithServer({ client: offline, outboxPath, now: () => 1_000, captureRetryDelaysMs: [10, 10] });
    const firstToken = await trustedToken(first.base);
    const captureId = '00000000-0000-4000-8000-000000000003';
    await capture(first.base, firstToken, { captureId, mode: 'memo', front: '等待 Anki', tags: [] });
    await waitForCaptureStatus(first.base, firstToken, captureId, 'queued');
    await stop(first.server);

    const calls: { deck: string; model: string; fields: Record<string, string>; tags: string[] } = { deck: '', model: '', fields: {}, tags: [] };
    const second = await startWithServer({
      outboxPath,
      now: () => 2_000,
      client: fakeAnki({
        deckNames: async () => ['Ankimo'],
        modelFieldNames: async () => ['引用', '备注'],
        addNote: async (deck, model, fields, tags) => {
          calls.deck = deck;
          calls.model = model;
          calls.fields = fields;
          calls.tags = tags || [];
          return 903;
        }
      })
    });
    const secondToken = await trustedToken(second.base);
    const synced = await waitForCaptureStatus(second.base, secondToken, captureId, 'synced');
    expect(synced.noteId).toBe(903);
    expect(calls).toMatchObject({ deck: 'Ankimo', model: 'XXHK - 划线', tags: [] });
    expect(calls.fields['引用']).toContain('等待 Anki');
  });

  it('marks interrupted writing as unknown and never retries addNote after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-capture-test-'));
    tempDirs.push(dir);
    const outboxPath = join(dir, 'outbox.sqlite3');
    const pending = new Promise<number>(() => undefined);
    const first = await startWithServer({
      outboxPath,
      client: fakeAnki({ deckNames: async () => ['Ankimo'], addNote: async () => pending })
    });
    const firstToken = await trustedToken(first.base);
    const captureId = '00000000-0000-4000-8000-000000000004';
    await capture(first.base, firstToken, { captureId, mode: 'qa', front: '问题', back: '答案', tags: [] });
    await waitForCaptureStatus(first.base, firstToken, captureId, 'writing');
    await stop(first.server);

    let retries = 0;
    const second = await startWithServer({
      outboxPath,
      client: fakeAnki({ deckNames: async () => ['Ankimo'], addNote: async () => { retries += 1; return 904; } })
    });
    const secondToken = await trustedToken(second.base);
    const attention = await waitForCaptureStatus(second.base, secondToken, captureId, 'needs_attention');
    expect(attention).toMatchObject({ captureId, status: 'needs_attention', errorCode: 'WRITE_STATUS_UNKNOWN' });
    expect(retries).toBe(0);
  });

  it('writes memo and QA captures as active fixed native notes without suspension', async () => {
    const models: string[] = [];
    const calls: { deck: string; model: string; fields: Record<string, string>; tags: string[]; suspended: number } = {
      deck: '', model: '', fields: {}, tags: [], suspended: 0
    };
    const base = await start({ client: fakeAnki({
      deckNames: async () => ['Ankimo'],
      modelFieldNames: async model => model === 'XXHK - 问答' ? ['问题', '答案'] : ['引用', '备注'],
      addNote: async (deck, model, fields, tags) => {
        models.push(model);
        calls.deck = deck;
        calls.model = model;
        calls.fields = fields;
        calls.tags = tags || [];
        return model === 'XXHK - 问答' ? 906 : 905;
      },
      findCards: async () => { calls.suspended += 1; return [1]; },
      suspend: async () => { calls.suspended += 1; return null; },
      areSuspended: async () => { calls.suspended += 1; return [true]; }
    }) });
    const bearer = await trustedToken(base);
    const memoId = '00000000-0000-4000-8000-000000000005';
    const qaId = '00000000-0000-4000-8000-000000000006';
    await capture(base, bearer, { captureId: memoId, mode: 'memo', front: 'active memo', tags: ['memo'] });
    await capture(base, bearer, { captureId: qaId, mode: 'qa', front: 'question', back: 'answer', tags: ['qa'] });
    await waitForCaptureStatus(base, bearer, memoId, 'synced');
    await waitForCaptureStatus(base, bearer, qaId, 'synced');
    expect(calls.suspended).toBe(0);
    expect(models).toEqual(['XXHK - 划线', 'XXHK - 问答']);
    expect(calls.deck).toBe('Ankimo');
    expect(calls.model).toBe('XXHK - 问答');
    expect(calls.fields).toMatchObject({ 问题: expect.stringContaining('question'), 答案: expect.stringContaining('answer') });
  });

  it('transcribes one audio capture and stores text plus playable Anki media', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-audio-capture-test-'));
    tempDirs.push(dir);
    const captureId = '00000000-0000-4000-8000-00000000000b';
    const audio = Buffer.from('small fake m4a');
    let transcriptions = 0;
    let storedMedia = '';
    let fields: Record<string, string> = {};
    const base = await start({
      outboxPath: join(dir, 'outbox.sqlite3'),
      captureMediaPath: join(dir, 'audio'),
      transcribeAudio: async path => {
        transcriptions += 1;
        expect(existsSync(path)).toBe(true);
        return '转录文字';
      },
      client: fakeAnki({
        deckNames: async () => ['Ankimo'],
        storeMediaFileBase64: async (filename, data) => {
          storedMedia = filename;
          expect(Buffer.from(data, 'base64')).toEqual(audio);
          return filename;
        },
        addNote: async (_deck, _model, values) => {
          fields = values;
          return 910;
        },
        notesInfo: async () => [{
          noteId: 910,
          fields: { 引用: { value: fields['引用'] || '', order: 0 } },
          tags: []
        }]
      })
    });
    const body = {
      captureId,
      mode: 'memo',
      front: '手输文字',
      tags: [],
      audio: { format: 'm4a', data: audio.toString('base64') }
    };

    expect((await capture(base, '', body)).response.status).toBe(202);
    const synced = await waitForCaptureStatus(base, '', captureId, 'synced');
    expect(synced).toMatchObject({ noteId: 910, status: 'synced' });
    expect(transcriptions).toBe(1);
    expect(storedMedia).toBe(`ankimo-${captureId}.m4a`);
    expect(fields['引用']).toContain('手输文字');
    expect(fields['引用']).toContain('转录文字');
    expect(fields['引用']).toContain(`[sound:ankimo-${captureId}.m4a]`);
    expect(existsSync(join(dir, 'audio', `${captureId}.m4a`))).toBe(false);

    expect((await capture(base, '', body)).body).toMatchObject({ status: 'synced', noteId: 910 });
    expect(transcriptions).toBe(1);
  });

  it('never retries an ambiguous transcription until the user asks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-audio-retry-test-'));
    tempDirs.push(dir);
    const captureId = '00000000-0000-4000-8000-00000000000c';
    let attempts = 0;
    let fields: Record<string, string> = {};
    const base = await start({
      outboxPath: join(dir, 'outbox.sqlite3'),
      captureMediaPath: join(dir, 'audio'),
      transcribeAudio: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('ambiguous timeout');
        return '用户确认后重试成功';
      },
      client: fakeAnki({
        deckNames: async () => ['Ankimo'],
        addNote: async (_deck, _model, values) => {
          fields = values;
          return 911;
        },
        notesInfo: async () => [{
          noteId: 911,
          fields: { 引用: { value: fields['引用'] || '', order: 0 } },
          tags: []
        }]
      })
    });
    await capture(base, '', {
      captureId,
      mode: 'memo',
      front: '',
      tags: [],
      audio: { format: 'm4a', data: Buffer.from('voice').toString('base64') }
    });
    const attention = await waitForCaptureStatus(base, '', captureId, 'needs_attention');
    expect(attention).toMatchObject({ errorCode: 'TYPELESS_FAILED' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(attempts).toBe(1);

    const retry = await request(base, `/api/captures/${captureId}/retry-transcription`, {
      method: 'POST',
      headers: { 'X-Ankimo-Client-Verified': '1' }
    });
    expect(retry.response.status).toBe(202);
    expect((await waitForCaptureStatus(base, '', captureId, 'synced')).noteId).toBe(911);
    expect(attempts).toBe(2);
  });

  it('marks an interrupted transcription unknown after restart without uploading again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ankimo-audio-restart-test-'));
    tempDirs.push(dir);
    const outboxPath = join(dir, 'outbox.sqlite3');
    const captureMediaPath = join(dir, 'audio');
    const captureId = '00000000-0000-4000-8000-00000000000d';
    let started = false;
    const first = await startWithServer({
      outboxPath,
      captureMediaPath,
      transcribeAudio: async () => {
        started = true;
        return new Promise<string>(() => undefined);
      },
      client: fakeAnki()
    });
    await capture(first.base, '', {
      captureId,
      mode: 'memo',
      front: '',
      tags: [],
      audio: { format: 'm4a', data: Buffer.from('voice').toString('base64') }
    });
    await waitForCaptureStatus(first.base, '', captureId, 'preparing');
    for (let attempt = 0; attempt < 30 && !started; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(started).toBe(true);
    await stop(first.server);

    let restartedUploads = 0;
    const second = await start({
      outboxPath,
      captureMediaPath,
      transcribeAudio: async () => {
        restartedUploads += 1;
        return '不应执行';
      },
      client: fakeAnki()
    });
    const attention = await waitForCaptureStatus(second, '', captureId, 'needs_attention');
    expect(attention).toMatchObject({ errorCode: 'TRANSCRIPTION_STATUS_UNKNOWN' });
    expect(restartedUploads).toBe(0);
  });

  it('exposes only the four AI operations in OpenAPI', async () => {
    const base = await start({ client: fakeAnki() });
    const { response, body } = await request(base, '/openapi.json');
    const operations = Object.values(body.paths as Record<string, Record<string, { operationId: string }>>)
      .flatMap(path => Object.values(path).map(operation => operation.operationId));

    expect(response.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect((body.info as Record<string, unknown>).version).toBe('1.2.1');
    expect(body.servers).toEqual([{ url: 'https://ankimo-api.yzr-stack.top' }]);
    expect(operations).toEqual(['listDecks', 'searchNotes', 'createMemo', 'createQaCard']);
    expect(JSON.stringify(body.paths)).toContain('nid:<noteId>');
    expect(JSON.stringify(body.components)).toContain('nid:1234567890');
    expect(body.paths).not.toHaveProperty('/health');
    expect((body.components as Record<string, unknown>)).toHaveProperty('securitySchemes');
  });
});
