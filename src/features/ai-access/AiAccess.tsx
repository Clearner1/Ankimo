import { useState } from 'react';

const AI_TOKEN_PATH = '/api/ai-tokens';
export const AI_OPENAPI_URL = 'https://ankimo-api.yzr-stack.top/openapi.json';
const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
} as const;

export type AiToken = {
  token: string;
  expiresAt: string;
  maxUses: number;
};

export type AiAccessFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const nestedError = isRecord(value.error) ? value.error : null;
  const message = value.message ?? nestedError?.message ?? value.error;
  return typeof message === 'string' && message ? message : null;
}

async function responseError(response: Response): Promise<never> {
  let message: string | null = null;
  try {
    message = errorText(await response.json());
  } catch {
    // The status still gives the caller a useful error when the body is not JSON.
  }
  throw new Error(message || `请求失败（HTTP ${response.status}）`);
}

function parseAiToken(value: unknown): AiToken {
  if (!isRecord(value) || typeof value.token !== 'string' || !value.token || typeof value.expiresAt !== 'string' || !value.expiresAt || typeof value.maxUses !== 'number' || !Number.isInteger(value.maxUses) || value.maxUses < 1) {
    throw new Error('临时 Token 响应格式无效');
  }
  return { token: value.token, expiresAt: value.expiresAt, maxUses: value.maxUses };
}

const defaultFetch: AiAccessFetch = (input, init) => globalThis.fetch(input, init);

export async function createAiToken(fetcher: AiAccessFetch = defaultFetch): Promise<AiToken> {
  const response = await fetcher(AI_TOKEN_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: JSON_HEADERS,
    body: JSON.stringify({})
  });
  if (!response.ok) await responseError(response);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('临时 Token 响应格式无效');
  }
  return parseAiToken(payload);
}

export async function revokeAiTokens(fetcher: AiAccessFetch = defaultFetch): Promise<void> {
  const response = await fetcher(AI_TOKEN_PATH, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: JSON_HEADERS
  });
  if (!response.ok) await responseError(response);
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function AiAccess() {
  const [token, setToken] = useState<AiToken | null>(null);
  const [busy, setBusy] = useState<'create' | 'copy' | 'revoke' | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const authorization = token ? `Bearer ${token.token}` : '';

  const generate = async () => {
    setBusy('create');
    setFeedback(null);
    try {
      setToken(await createAiToken());
      setFeedback({ message: '临时 Token 已生成，请立即复制到 AI 工具中。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `生成失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const copyAuthorization = async () => {
    if (!authorization) return;
    setBusy('copy');
    try {
      if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板');
      await navigator.clipboard.writeText(authorization);
      setFeedback({ message: 'Authorization 已复制。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `复制失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy('revoke');
    setFeedback(null);
    try {
      await revokeAiTokens();
      setToken(null);
      setFeedback({ message: '全部临时 Token 已撤销。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `撤销失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="input-card" aria-labelledby="aiAccessTitle">
      <div className="composer-head">
        <h2 id="aiAccessTitle">AI 临时访问</h2>
      </div>
      <p className="composer-hint">生成临时 Token 后，把 OpenAPI 地址和 Authorization 提供给支持 HTTP 工具的 AI。</p>
      <div className="composer-fields">
        <label className="control-field" htmlFor="aiOpenApiUrl">
          OpenAPI URL
          <span className="tag-input-wrap">
            <input id="aiOpenApiUrl" type="url" readOnly value={AI_OPENAPI_URL} />
          </span>
        </label>
      </div>
      <div className="filter-info" role="note">
        <span className="filter-dot" aria-hidden="true" />
        <span>有效期 15 分钟，最多 20 次调用</span>
      </div>

      {token && (
        <div className="composer-fields">
          <label className="control-field" htmlFor="aiAuthorization">
            Authorization
            <span className="tag-input-wrap">
              <input id="aiAuthorization" type="text" readOnly value={authorization} />
            </span>
          </label>
          <p className="composer-hint">只在当前页面显示，不写入 URL、浏览器存储或日志。</p>
          <p className="composer-hint">本次有效期至：{token.expiresAt}；最多 {token.maxUses} 次调用。</p>
        </div>
      )}

      <div className="composer-footer">
        <div className="tag-input-wrap" aria-hidden="true" />
        <div className="composer-actions">
          {token && <button className="clear-filter" type="button" disabled={busy !== null} onClick={() => { void copyAuthorization(); }}>复制 Authorization</button>}
          {token && <button className="clear-filter" type="button" disabled={busy !== null} onClick={() => { void revoke(); }}>撤销全部 Token</button>}
          <button className="save-btn" type="button" disabled={busy !== null} onClick={() => { void generate(); }}>
            {busy === 'create' ? '生成中...' : '生成临时 Token'}
          </button>
        </div>
      </div>

      {feedback && <div className={`toast ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.message}</div>}
    </section>
  );
}
