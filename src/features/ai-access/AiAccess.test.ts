import { describe, expect, it } from 'vitest';
import { createAiConnection, revokeAiTokens, type AiAccessFetch } from './AiAccess';

function fetchResponse(body: unknown, status = 200): AiAccessFetch {
  return async () => new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('AI temporary access API', () => {
  it('creates a connection link with same-origin JSON request settings', async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetcher: AiAccessFetch = async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({ connectUrl: 'https://ankimo-api.yzr-stack.top/connect/temporary-code', expiresAt: '2026-08-09T12:02:00.000Z', expiresIn: 120 }));
    };

    await expect(createAiConnection(fetcher)).resolves.toEqual({
      connectUrl: 'https://ankimo-api.yzr-stack.top/connect/temporary-code', expiresAt: '2026-08-09T12:02:00.000Z', expiresIn: 120
    });
    expect(request).toMatchObject({
      input: '/api/ai-connections',
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
    await expect(createAiConnection(fetchResponse({ message: '未授权' }, 401))).rejects.toThrow('未授权');
    await expect(createAiConnection(fetchResponse({ error: { code: 'FAILED', message: '生成失败' } }, 500))).rejects.toThrow('生成失败');
    await expect(revokeAiTokens(async () => { throw new Error('网络不可用'); })).rejects.toThrow('网络不可用');
  });

  it('rejects malformed connection responses', async () => {
    await expect(createAiConnection(fetchResponse({ connectUrl: '', expiresAt: '', expiresIn: 0 }))).rejects.toThrow('响应格式无效');
  });
});
