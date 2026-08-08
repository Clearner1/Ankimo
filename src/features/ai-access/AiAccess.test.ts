import { describe, expect, it } from 'vitest';
import { createAiToken, revokeAiTokens, type AiAccessFetch } from './AiAccess';

function fetchResponse(body: unknown, status = 200): AiAccessFetch {
  return async () => new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('AI temporary token API', () => {
  it('creates a token with same-origin JSON request settings', async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetcher: AiAccessFetch = async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({ token: 'temporary-token', expiresAt: '2026-08-09T12:15:00.000Z', maxUses: 20 }));
    };

    await expect(createAiToken(fetcher)).resolves.toEqual({
      token: 'temporary-token', expiresAt: '2026-08-09T12:15:00.000Z', maxUses: 20
    });
    expect(request).toMatchObject({
      input: '/api/ai-tokens',
      init: {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}'
      }
    });
  });

  it('revokes all tokens with a same-origin JSON request', async () => {
    let request: RequestInit | undefined;
    const fetcher: AiAccessFetch = async (_input, init) => {
      request = init;
      return new Response(null, { status: 204 });
    };

    await expect(revokeAiTokens(fetcher)).resolves.toBeUndefined();
    expect(request).toMatchObject({
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    });
  });

  it('reports non-success responses and network errors', async () => {
    await expect(createAiToken(fetchResponse({ message: '未授权' }, 401))).rejects.toThrow('未授权');
    await expect(createAiToken(fetchResponse({ error: { code: 'FAILED', message: '生成失败' } }, 500))).rejects.toThrow('生成失败');
    await expect(revokeAiTokens(async () => { throw new Error('网络不可用'); })).rejects.toThrow('网络不可用');
  });

  it('rejects malformed token responses', async () => {
    await expect(createAiToken(fetchResponse({ token: '', expiresAt: '', maxUses: 0 }))).rejects.toThrow('响应格式无效');
  });
});
