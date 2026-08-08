import { afterEach, describe, expect, it } from 'vitest';
import { createAnkimoApiServer, MAX_TOKEN_CALLS, TOKEN_TTL_MS, type AnkimoApiOptions } from './ankimo-api.mts';

type FakeAnki = {
  deckNames: () => Promise<string[]>;
  modelFieldNames: (model: string) => Promise<string[]>;
  addNote: (deck: string, model: string, fields: Record<string, string>, tags?: string[]) => Promise<number>;
  findCards: (query: string) => Promise<number[]>;
  suspend: (cards: number[]) => Promise<null>;
  areSuspended: (cards: number[]) => Promise<boolean[]>;
};

const servers: ReturnType<typeof createAnkimoApiServer>[] = [];

function fakeAnki(overrides: Partial<FakeAnki> = {}): FakeAnki {
  return {
    deckNames: async () => ['mubu', 'other'],
    modelFieldNames: async model => model === 'XXHK - 问答' ? ['问题', '答案', '引用'] : ['引用'],
    addNote: async () => 101,
    findCards: async () => [201],
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

async function request(base: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  return { response, body: await response.json() as Record<string, unknown> };
}

async function token(base: string): Promise<string> {
  const { response, body } = await request(base, '/api/ai-tokens', { method: 'POST' });
  expect(response.status).toBe(200);
  expect(body.maxUses).toBe(MAX_TOKEN_CALLS);
  if (typeof body.token !== 'string') throw new Error('token response missing token');
  return body.token;
}

function auth(tokenValue: string, body?: unknown): RequestInit {
  return {
    headers: { Authorization: `Bearer ${tokenValue}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('Ankimo HTTP API', () => {
  it('limits bearer calls and expires tokens', async () => {
    let currentTime = 1_000_000;
    const base = await start({ client: fakeAnki(), now: () => currentTime });
    const replaced = await token(base);
    const bearer = await token(base);
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${replaced}` } })).response.status).toBe(401);

    for (let call = 0; call < MAX_TOKEN_CALLS; call++) {
      const result = await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${bearer}` } });
      expect(result.response.status).toBe(200);
    }
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${bearer}` } })).response.status).toBe(401);

    const expiring = await token(base);
    currentTime += TOKEN_TTL_MS + 1;
    expect((await request(base, '/v1/decks', { headers: { Authorization: `Bearer ${expiring}` } })).response.status).toBe(401);
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
    const bearer = await token(base);

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
    const bearer = await token(base);
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

  it('exposes only the three AI operations in OpenAPI', async () => {
    const base = await start({ client: fakeAnki() });
    const { response, body } = await request(base, '/openapi.json');
    const operations = Object.values(body.paths as Record<string, Record<string, { operationId: string }>>)
      .flatMap(path => Object.values(path).map(operation => operation.operationId));

    expect(response.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.servers).toEqual([{ url: 'https://api.ankimo.yzr-stack.top' }]);
    expect(operations).toEqual(['listDecks', 'createMemo', 'createQaCard']);
    expect(body.paths).not.toHaveProperty('/health');
    expect((body.components as Record<string, unknown>)).toHaveProperty('securitySchemes');
  });
});
