import { useState } from 'react';

const AI_TOKEN_PATH = '/api/ai-tokens';
const AI_CONNECTION_PATH = '/api/ai-connections';
export const AI_OPENAPI_URL = 'https://ankimo-api.yzr-stack.top/openapi.json';
const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
} as const;

export type AiConnection = {
  connectUrl: string;
  expiresAt: string;
  expiresIn: number;
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

function parseAiConnection(value: unknown): AiConnection {
  if (!isRecord(value) || typeof value.connectUrl !== 'string' || !value.connectUrl || typeof value.expiresAt !== 'string' || !value.expiresAt || typeof value.expiresIn !== 'number' || !Number.isInteger(value.expiresIn) || value.expiresIn < 1) {
    throw new Error('AI 连接链接响应格式无效');
  }
  return { connectUrl: value.connectUrl, expiresAt: value.expiresAt, expiresIn: value.expiresIn };
}

const defaultFetch: AiAccessFetch = (input, init) => globalThis.fetch(input, init);

export async function createAiConnection(fetcher: AiAccessFetch = defaultFetch): Promise<AiConnection> {
  const response = await fetcher(AI_CONNECTION_PATH, {
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
    throw new Error('AI 连接链接响应格式无效');
  }
  return parseAiConnection(payload);
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
  const [connection, setConnection] = useState<AiConnection | null>(null);
  const [busy, setBusy] = useState<'create' | 'copy' | 'revoke' | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const generate = async () => {
    setBusy('create');
    setFeedback(null);
    try {
      setConnection(await createAiConnection());
      setFeedback({ message: '一次性连接链接已生成，请在 2 分钟内发送给 AI。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `生成失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const copyConnection = async () => {
    if (!connection) return;
    setBusy('copy');
    try {
      if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板');
      await navigator.clipboard.writeText(connection.connectUrl);
      setFeedback({ message: 'AI 连接链接已复制。', type: 'success' });
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
      setConnection(null);
      setFeedback({ message: '全部 AI 临时访问已撤销。', type: 'success' });
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
      <p className="composer-hint">生成一次性连接链接后，只需把链接提供给支持 HTTP 工具的 AI。</p>
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
        <span>连接链接 2 分钟内可兑换一次；兑换后的访问有效 15 分钟，最多 20 次调用</span>
      </div>

      {connection && (
        <div className="composer-fields">
          <label className="control-field" htmlFor="aiConnectionUrl">
            AI 连接链接
            <span className="tag-input-wrap">
              <input id="aiConnectionUrl" type="url" readOnly value={connection.connectUrl} />
            </span>
          </label>
          <p className="composer-hint">只在当前页面显示，不写入浏览器存储或日志；生成新链接会使旧链接失效。</p>
          <p className="composer-hint">请在 {connection.expiresAt} 前让 AI 访问并兑换。</p>
        </div>
      )}

      <div className="composer-footer">
        <div className="tag-input-wrap" aria-hidden="true" />
        <div className="composer-actions">
          {connection && <button className="clear-filter" type="button" disabled={busy !== null} onClick={() => { void copyConnection(); }}>复制连接链接</button>}
          <button className="clear-filter" type="button" disabled={busy !== null} onClick={() => { void revoke(); }}>撤销全部访问</button>
          <button className="save-btn" type="button" disabled={busy !== null} onClick={() => { void generate(); }}>
            {busy === 'create' ? '生成中...' : '生成 AI 连接链接'}
          </button>
        </div>
      </div>

      {feedback && <div className={`toast ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.message}</div>}
    </section>
  );
}
