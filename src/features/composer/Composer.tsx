import { useEffect, useState } from 'react';
import { AnkiConnect } from '../../api/ankiConnect';

export type ComposerToast = (message: string, type?: 'success' | 'error') => void;

export type ComposerApi = Pick<AnkiConnect,
  'deckNames' | 'createDeck' | 'modelNames' | 'modelFieldNames' | 'addNote' | 'findCards' | 'suspend' | 'areSuspended'>;

export type ComposerProps = {
  client?: ComposerApi;
  onCreated?: (noteId: number) => void | Promise<void>;
  onToast?: ComposerToast;
};

export type NoteMode = 'memo' | 'qa';

export const MEMO_DECK = 'Ankimo';

const defaultClient = new AnkiConnect();

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function buildComposerFields(fieldNames: readonly string[], front: string, back: string, mode: NoteMode): Record<string, string> {
  return Object.fromEntries(fieldNames.map((name, index) => [name, index === 0 ? front : mode === 'qa' && index === 1 ? back : '']));
}

export async function findMemoCards(client: Pick<AnkiConnect, 'findCards'>, noteId: number, attempts = 3, delayMs = 120): Promise<number[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const cards = await client.findCards(`nid:${noteId}`);
    if (cards.length) return cards;
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return [];
}

export async function suspendMemoNote(client: Pick<AnkiConnect, 'findCards' | 'suspend' | 'areSuspended'>, noteId: number): Promise<void> {
  const cards = await findMemoCards(client, noteId);
  if (!cards.length) throw new Error(`已创建 note ${noteId}，但没有找到对应卡片，无法确认暂停状态`);
  await client.suspend(cards);
  const suspended = await client.areSuspended(cards);
  if (suspended.length !== cards.length || !suspended.every(Boolean)) {
    throw new Error(`已创建 note ${noteId}，但回读确认并非所有卡片都已暂停`);
  }
}

export function Composer({ client = defaultClient, onCreated, onToast }: ComposerProps) {
  const [mode, setMode] = useState<NoteMode>('memo');
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [deck, setDeck] = useState('');
  const [model, setModel] = useState('');
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([client.deckNames(), client.modelNames()]).then(([nextDecks, nextModels]) => {
      if (!active) return;
      setDecks(nextDecks);
      setModels(nextModels);
      setDeck(current => current || nextDecks[0] || '');
      setModel(current => current || nextModels[0] || '');
    }).catch(cause => onToast?.(`加载失败: ${errorMessage(cause)}`, 'error')).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, onToast]);

  useEffect(() => {
    if (!model) {
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return undefined;
      setLoadingFields(true);
      return client.modelFieldNames(model);
    }).then(names => {
      if (!names) return;
      if (active) setFieldNames(names);
    }).catch(cause => {
      if (active) {
        setFieldNames([]);
        onToast?.(`加载模板字段失败: ${errorMessage(cause)}`, 'error');
      }
    }).finally(() => {
      if (active) setLoadingFields(false);
    });
    return () => { active = false; };
  }, [client, model, onToast]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedFront = front.trim();
    const trimmedBack = back.trim();
    if (!trimmedFront) {
      onToast?.(mode === 'memo' ? '请输入笔记内容' : '请输入问题', 'error');
      return;
    }
    if (mode === 'qa' && !trimmedBack) {
      onToast?.('请输入答案', 'error');
      return;
    }
    if (!model) {
      onToast?.('请先选择笔记模板', 'error');
      return;
    }
    setSaving(true);
    let noteId: number | null = null;
    try {
      const selectedDeck = mode === 'memo' ? MEMO_DECK : deck;
      if (!selectedDeck) throw new Error('请先选择牌组');
      if (mode === 'memo' && !decks.includes(MEMO_DECK)) {
        await client.createDeck(MEMO_DECK);
        setDecks(current => current.includes(MEMO_DECK) ? current : [...current, MEMO_DECK]);
      }
      let names = fieldNames;
      if (!names.length) names = await client.modelFieldNames(model);
      if (!names.length) throw new Error('当前模板没有可用字段');
      if (mode === 'qa' && names.length < 2) throw new Error('问答模式需要至少两个字段');
      noteId = await client.addNote(selectedDeck, model, buildComposerFields(names, trimmedFront, trimmedBack, mode), tags.trim().split(/\s+/).filter(Boolean));
      if (!noteId) throw new Error('AnkiConnect 没有返回 note id，无法确认创建结果');
      if (mode === 'memo') await suspendMemoNote(client, noteId);
      setFront('');
      setBack('');
      setTags('');
      onToast?.(mode === 'memo' ? '短笔记已保存，已暂停' : '问答卡片已保存');
      await onCreated?.(noteId);
    } catch (cause) {
      const message = noteId && mode === 'memo' ? `短笔记已创建，但暂停失败（note id: ${noteId}）：${errorMessage(cause)}` : `保存失败: ${errorMessage(cause)}`;
      onToast?.(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isMemo = mode === 'memo';
  return (
    <form id="inputCard" className={`input-card ${isMemo ? 'memo-mode' : 'qa-mode'}`} aria-labelledby="composerTitle" onSubmit={create}>
      <input id="noteModeMemo" className="visually-hidden" type="radio" name="noteMode" value="memo" aria-describedby="modeDescription" checked={isMemo} onChange={() => setMode('memo')} />
      <input id="noteModeQa" className="visually-hidden" type="radio" name="noteMode" value="qa" aria-describedby="modeDescription" checked={!isMemo} onChange={() => setMode('qa')} />
      <div className="composer-head">
        <h2 id="composerTitle">快速记录</h2>
        <div className="mode-switch" role="group" aria-label="笔记类型" aria-describedby="modeDescription">
          <label className={`mode-label ${isMemo ? 'active' : ''}`} htmlFor="noteModeMemo">短笔记</label>
          <label className={`mode-label ${!isMemo ? 'active' : ''}`} htmlFor="noteModeQa">问答卡</label>
        </div>
      </div>
      <p id="modeDescription" className="composer-hint">{isMemo ? '短笔记会保存到 Ankimo 牌组，保存后暂停，不进入日常复习。' : '问答卡会保留所选牌组，正常参与 Anki 日常复习。'}</p>
      <div className="composer-fields">
        <textarea id="frontInput" value={front} onChange={event => setFront(event.target.value)} placeholder={isMemo ? '现在的想法是…' : '正面 / 问题...'} aria-label={isMemo ? '笔记内容' : '问题'} />
        <textarea id="backInput" value={back} onChange={event => setBack(event.target.value)} placeholder={isMemo ? '' : '背面 / 答案...'} aria-label={isMemo ? '笔记模式不使用答案' : '答案'} disabled={isMemo} aria-hidden={isMemo} />
      </div>
      <input id="advancedToggle" className="visually-hidden" type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} />
      <div className="composer-footer">
        <div className="tag-input-wrap">
          <input id="tagInput" value={tags} onChange={event => setTags(event.target.value)} placeholder="添加标签，用空格分隔" aria-label="标签" />
        </div>
        <div className="composer-actions">
          <label className="advanced-toggle" htmlFor="advancedToggle">高级设置 <span className="advanced-chevron" aria-hidden="true"><svg viewBox="0 0 12 7" width="12" height="7" focusable="false"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg></span></label>
          <button id="saveBtn" className="save-btn" type="submit" disabled={saving || loading || loadingFields}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
      <div className="advanced-controls">
        <label className="control-field" htmlFor="deckSelect">牌组
          <select id="deckSelect" value={isMemo ? MEMO_DECK : deck} disabled={isMemo || loading} onChange={event => setDeck(event.target.value)}>
            {isMemo && !decks.includes(MEMO_DECK) && <option value={MEMO_DECK}>{MEMO_DECK}</option>}
            {decks.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="control-field" htmlFor="modelSelect">模板
          <select id="modelSelect" value={model} disabled={loading} onChange={event => setModel(event.target.value)}>
            {models.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
    </form>
  );
}
