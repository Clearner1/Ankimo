import { useState } from 'react';
import styles from './AiAccess.module.css';

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

export type TrustedAiToken = {
  token: string;
  maxCallsPerMinute: number;
  maxCallsPerDay: number;
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

function parseTrustedAiToken(value: unknown): TrustedAiToken {
  if (!isRecord(value) || typeof value.token !== 'string' || !/^ank_live_[A-Za-z0-9_-]{43}$/.test(value.token) || typeof value.maxCallsPerMinute !== 'number' || !Number.isInteger(value.maxCallsPerMinute) || value.maxCallsPerMinute < 1 || typeof value.maxCallsPerDay !== 'number' || !Number.isInteger(value.maxCallsPerDay) || value.maxCallsPerDay < 1) {
    throw new Error('可信 AI 密钥响应格式无效');
  }
  return { token: value.token, maxCallsPerMinute: value.maxCallsPerMinute, maxCallsPerDay: value.maxCallsPerDay };
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

export async function createTrustedAiToken(fetcher: AiAccessFetch = defaultFetch): Promise<TrustedAiToken> {
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
    throw new Error('可信 AI 密钥响应格式无效');
  }
  return parseTrustedAiToken(payload);
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
  const [trustedToken, setTrustedToken] = useState<TrustedAiToken | null>(null);
  const [busy, setBusy] = useState<'connection' | 'trusted' | 'copy' | 'revoke' | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const generate = async () => {
    setBusy('connection');
    setFeedback(null);
    try {
      setConnection(await createAiConnection());
      setFeedback({ message: '一次性连接链接已生成，请在 10 分钟内发送给 AI。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `生成失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const generateTrusted = async () => {
    setBusy('trusted');
    setFeedback(null);
    try {
      setTrustedToken(await createTrustedAiToken());
      setFeedback({ message: '长期密钥已生成；旧长期密钥已失效。请立即保存到安全密钥存储。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `生成失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const copyValue = async (value: string, label: string) => {
    setBusy('copy');
    try {
      if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板');
      await navigator.clipboard.writeText(value);
      setFeedback({ message: `${label}已复制。`, type: 'success' });
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
      setTrustedToken(null);
      setFeedback({ message: '全部 AI 访问已撤销。', type: 'success' });
    } catch (cause) {
      setFeedback({ message: `撤销失败：${causeMessage(cause)}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`input-card ${styles.inputCard}`} aria-labelledby="aiAccessTitle">
      <div className={`composer-head ${styles.composerHead}`}>
        <h2 id="aiAccessTitle">AI 访问</h2>
      </div>
      <p className={`composer-hint ${styles.composerHint}`}>日常使用请选择长期密钥；不能安全保存密钥的 AI 仍使用一次性连接链接。</p>
      <div className={`composer-fields ${styles.composerFields}`}>
        <label className={`control-field ${styles.controlField}`} htmlFor="aiOpenApiUrl">
          OpenAPI URL
          <span className={`tag-input-wrap ${styles.tagInputWrap}`}>
            <input className={styles.input} id="aiOpenApiUrl" type="url" readOnly value={AI_OPENAPI_URL} />
          </span>
        </label>
      </div>
      <div className="filter-info" role="note">
        <span className="filter-dot" aria-hidden="true" />
        <span>临时链接 10 分钟内可兑换一次，访问有效 1 小时、最多 100 次；长期密钥有效到主动撤销，每分钟 20 次、每天 200 次</span>
      </div>

      {trustedToken && (
        <div className={`composer-fields ${styles.composerFields}`}>
          <label className={`control-field ${styles.controlField}`} htmlFor="aiTrustedToken">
            可信 AI 长期密钥
            <span className={`tag-input-wrap ${styles.tagInputWrap}`}>
              <input className={styles.input} id="aiTrustedToken" type="password" readOnly autoComplete="off" spellCheck={false} value={trustedToken.token} />
            </span>
          </label>
          <p className={`composer-hint ${styles.composerHint}`}>只在当前页面显示一次。请保存到 AI 平台的 Secret Store 或本机 Keychain，切勿发送到聊天。</p>
          <p className={`composer-hint ${styles.composerHint}`}>本机 Codex：复制后在终端运行 codex-secret save ankimo，并按隐藏提示保存。</p>
          <div className={`composer-footer ${styles.composerFooter}`}>
            <div className={`tag-input-wrap ${styles.tagInputWrap}`} aria-hidden="true" />
            <div className={`composer-actions ${styles.composerActions}`}>
              <button className={`clear-filter ${styles.secondaryButton}`} type="button" disabled={busy !== null} onClick={() => { void generateTrusted(); }}>重置长期密钥</button>
              <button className={`save-btn ${styles.saveBtn}`} type="button" disabled={busy !== null} onClick={() => { void copyValue(trustedToken.token, '长期密钥'); }}>复制长期密钥</button>
            </div>
          </div>
        </div>
      )}

      {connection && (
        <div className={`composer-fields ${styles.composerFields}`}>
          <label className={`control-field ${styles.controlField}`} htmlFor="aiConnectionUrl">
            AI 连接链接
            <span className={`tag-input-wrap ${styles.tagInputWrap}`}>
              <input className={styles.input} id="aiConnectionUrl" type="url" readOnly value={connection.connectUrl} />
            </span>
          </label>
          <p className={`composer-hint ${styles.composerHint}`}>只在当前页面显示，不写入浏览器存储或日志；只能兑换一次。</p>
          <p className={`composer-hint ${styles.composerHint}`}>请在 {connection.expiresAt} 前让 AI 访问并兑换。</p>
          <div className={`composer-footer ${styles.composerFooter}`}>
            <div className={`tag-input-wrap ${styles.tagInputWrap}`} aria-hidden="true" />
            <div className={`composer-actions ${styles.composerActions}`}>
              <button className={`save-btn ${styles.saveBtn}`} type="button" disabled={busy !== null} onClick={() => { void copyValue(connection.connectUrl, 'AI 连接链接'); }}>复制连接链接</button>
            </div>
          </div>
        </div>
      )}

      <div className={`composer-footer ${styles.composerFooter}`}>
        <div className={`tag-input-wrap ${styles.tagInputWrap}`} aria-hidden="true" />
        <div className={`composer-actions ${styles.composerActions}`}>
          <button className={`clear-filter ${styles.secondaryButton}`} type="button" disabled={busy !== null} onClick={() => { void revoke(); }}>撤销全部访问</button>
          <button className={`clear-filter ${styles.secondaryButton}`} type="button" disabled={busy !== null} onClick={() => { void generate(); }}>
            {busy === 'connection' ? '生成中...' : '生成临时连接'}
          </button>
          {!trustedToken && <button className={`save-btn ${styles.saveBtn}`} type="button" disabled={busy !== null} onClick={() => { void generateTrusted(); }}>
            {busy === 'trusted' ? '生成中...' : '生成长期密钥'}
          </button>}
        </div>
      </div>

      {feedback && <div className={`toast ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.message}</div>}
    </section>
  );
}
