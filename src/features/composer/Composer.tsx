import { useEffect, useState } from 'react';
import { AnkiConnect } from '../../api/ankiConnect';
import {
  buildNoteFields,
  MEMO_MODEL,
  noteTextToHtml,
  QA_MODEL,
  suspendMemoNote,
  type NoteMode
} from '../../domain/noteWriting';
import { TagInput } from '../navigation/TagInput';

export { MEMO_MODEL, QA_MODEL, suspendMemoNote, type NoteMode } from '../../domain/noteWriting';

export type ComposerToast = (message: string, type?: 'success' | 'error') => void;

export type ComposerApi = Pick<AnkiConnect,
  'deckNames' | 'createDeck' | 'modelNames' | 'modelFieldNames' | 'addNote' | 'findCards' | 'suspend' | 'areSuspended' |
  'storeMediaFileBase64' | 'deleteMediaFile'>;

export type ComposerProps = {
  client?: ComposerApi;
  allTags?: readonly string[];
  onCreated?: (noteId: number) => void | Promise<void>;
  onToast?: ComposerToast;
};

export const MEMO_DECK = 'Ankimo';
export const COMPOSER_PREFERENCES_KEY = 'ankimo_composer_preferences_v1';
export const MAX_COMPOSER_IMAGES = 4;
export const MAX_COMPOSER_IMAGE_SIZE = 10 * 1024 * 1024;

type ImageExtension = 'png' | 'jpg' | 'webp';

type PendingImage = {
  id: string;
  name: string;
  extension: ImageExtension;
  dataUrl: string;
};

export type ComposerPreferences = {
  memo: { model: string; tags: string };
  qa: { deck: string; model: string; tags: string };
};

type ComposerStorage = Pick<Storage, 'getItem' | 'setItem'>;

const defaultClient = new AnkiConnect();

function defaultPreferences(): ComposerPreferences {
  return {
    memo: { model: MEMO_MODEL, tags: '' },
    qa: { deck: '', model: QA_MODEL, tags: '' }
  };
}

function composerStorage(storage?: ComposerStorage): ComposerStorage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function loadComposerPreferences(storage?: ComposerStorage): ComposerPreferences {
  const defaults = defaultPreferences();
  const target = composerStorage(storage);
  if (!target) return defaults;
  try {
    const parsed: unknown = JSON.parse(target.getItem(COMPOSER_PREFERENCES_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return defaults;
    const memo = 'memo' in parsed && parsed.memo && typeof parsed.memo === 'object' ? parsed.memo : {};
    const qa = 'qa' in parsed && parsed.qa && typeof parsed.qa === 'object' ? parsed.qa : {};
    return {
      memo: {
        model: stringValue('model' in memo ? memo.model : undefined, MEMO_MODEL),
        tags: stringValue('tags' in memo ? memo.tags : undefined)
      },
      qa: {
        deck: stringValue('deck' in qa ? qa.deck : undefined),
        model: stringValue('model' in qa ? qa.model : undefined, QA_MODEL),
        tags: stringValue('tags' in qa ? qa.tags : undefined)
      }
    };
  } catch {
    return defaults;
  }
}

export function saveComposerPreference(mode: NoteMode, preferences: ComposerPreferences, storage?: ComposerStorage): void {
  const target = composerStorage(storage);
  if (!target) return;
  try {
    const saved = loadComposerPreferences(target);
    const next = mode === 'memo'
      ? { ...saved, memo: preferences.memo }
      : { ...saved, qa: preferences.qa };
    target.setItem(COMPOSER_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Preferences are optional; note creation must still succeed without storage.
  }
}

export function availableOption(preferred: string, fallback: string, options: readonly string[]): string {
  if (options.includes(preferred)) return preferred;
  if (options.includes(fallback)) return fallback;
  return options[0] || '';
}

export function imageExtensionForType(type: string): ImageExtension | null {
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return null;
}

export function validateImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!imageExtensionForType(file.type)) return '仅支持 PNG、JPEG 或 WebP 图片';
  if (file.size > MAX_COMPOSER_IMAGE_SIZE) return '单张图片不能超过 10MB';
  return null;
}

export function base64FromDataUrl(dataUrl: string): string {
  const separator = dataUrl.indexOf(',');
  return separator === -1 ? dataUrl : dataUrl.slice(separator + 1);
}

export function createMediaFilename(extension: ImageExtension, uuid: string = globalThis.crypto.randomUUID()): string {
  return `ankimo-${uuid}.${extension}`;
}

export function appendMemoImages(front: string, filenames: readonly string[]): string {
  if (!filenames.length) return front;
  const images = filenames.map(filename => `<img src="${filename}" alt="" />`);
  return [front, ...images].filter(Boolean).join('\n\n');
}

export function composerTextToHtml(value: string): string {
  return noteTextToHtml(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function buildComposerFields(fieldNames: readonly string[], front: string, back: string, mode: NoteMode): Record<string, string> {
  return buildNoteFields(fieldNames, front, back, mode);
}

function readPendingImage(file: File, extension: ImageExtension): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`无法读取图片: ${file.name}`));
        return;
      }
      resolve({
        id: globalThis.crypto.randomUUID(),
        name: file.name,
        extension,
        dataUrl: reader.result
      });
    };
    reader.onerror = () => reject(new Error(`无法读取图片: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function cleanupMediaFiles(client: Pick<ComposerApi, 'deleteMediaFile'>, filenames: readonly string[]): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(filenames.map(async filename => {
    try {
      await client.deleteMediaFile(filename);
    } catch {
      failed.push(filename);
    }
  }));
  return failed;
}

export async function writeComposerNote(
  client: Pick<ComposerApi, 'storeMediaFileBase64' | 'deleteMediaFile' | 'addNote'>,
  input: {
    deck: string;
    model: string;
    fieldNames: readonly string[];
    front: string;
    back: string;
    mode: NoteMode;
    tags: string[];
    images: readonly { name: string; extension: ImageExtension; dataUrl: string }[];
  }
): Promise<{ noteId: number } | { error: string }> {
  const mediaToDelete = new Set<string>();
  const mediaFilenames: string[] = [];
  try {
    if (input.mode === 'memo') {
      for (const image of input.images) {
        const requestedFilename = createMediaFilename(image.extension);
        mediaToDelete.add(requestedFilename);
        const storedFilename = await client.storeMediaFileBase64(requestedFilename, base64FromDataUrl(image.dataUrl));
        if (!storedFilename) throw new Error(`图片上传失败: ${image.name}`);
        mediaToDelete.add(storedFilename);
        mediaFilenames.push(storedFilename);
      }
    }
  } catch (cause) {
    const cleanupFailed = await cleanupMediaFiles(client, [...mediaToDelete]);
    const warning = cleanupFailed.length ? `；${cleanupFailed.length} 张临时图片未能清理` : '';
    return { error: `保存失败: ${errorMessage(cause)}${warning}` };
  }

  let noteId: number | null;
  try {
    const front = composerTextToHtml(input.front);
    noteId = await client.addNote(
      input.deck,
      input.model,
      buildComposerFields(input.fieldNames, input.mode === 'memo' ? appendMemoImages(front, mediaFilenames) : front, composerTextToHtml(input.back), input.mode),
      input.tags
    );
  } catch (cause) {
    const mediaHint = mediaToDelete.size ? '；为避免破坏可能已创建的笔记，已上传图片将暂时保留' : '';
    return { error: `写入状态未知: ${errorMessage(cause)}。请先在 Anki 中确认，暂勿重复提交${mediaHint}` };
  }
  if (noteId) return { noteId };

  const cleanupFailed = await cleanupMediaFiles(client, [...mediaToDelete]);
  const warning = cleanupFailed.length ? `；${cleanupFailed.length} 张临时图片未能清理` : '';
  return { error: `保存失败: AnkiConnect 没有返回 note id，无法确认创建结果${warning}` };
}

export function Composer({ client = defaultClient, allTags = [], onCreated, onToast }: ComposerProps) {
  const [mode, setMode] = useState<NoteMode>('memo');
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [preferences, setPreferences] = useState(loadComposerPreferences);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [readingImages, setReadingImages] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const model = mode === 'memo' ? preferences.memo.model : preferences.qa.model;
  const tags = mode === 'memo' ? preferences.memo.tags : preferences.qa.tags;

  useEffect(() => {
    let active = true;
    void Promise.all([client.deckNames(), client.modelNames()]).then(([nextDecks, nextModels]) => {
      if (!active) return;
      const saved = loadComposerPreferences();
      const memoModel = availableOption(saved.memo.model, MEMO_MODEL, nextModels);
      const qaModel = availableOption(saved.qa.model, QA_MODEL, nextModels);
      setDecks(nextDecks);
      setModels(nextModels);
      setPreferences(current => ({
        memo: { ...current.memo, model: memoModel },
        qa: {
          ...current.qa,
          deck: availableOption(saved.qa.deck, '', nextDecks),
          model: qaModel
        }
      }));
      const missingDefaults = [
        !nextModels.includes(saved.memo.model) && !nextModels.includes(MEMO_MODEL) ? MEMO_MODEL : null,
        !nextModels.includes(saved.qa.model) && !nextModels.includes(QA_MODEL) ? QA_MODEL : null
      ].filter((name): name is string => Boolean(name));
      if (missingDefaults.length && nextModels.length) {
        onToast?.(`未找到默认模板 ${missingDefaults.join('、')}，已使用可用模板`, 'error');
      }
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

  const addImages = async (input: FileList | readonly File[] | null) => {
    if (saving || readingImages) return;
    const files = input ? Array.from(input) : [];
    if (!files.length) return;
    const room = MAX_COMPOSER_IMAGES - pendingImages.length;
    if (room <= 0) {
      onToast?.(`最多添加 ${MAX_COMPOSER_IMAGES} 张图片`, 'error');
      return;
    }
    if (files.length > room) onToast?.(`最多添加 ${MAX_COMPOSER_IMAGES} 张图片`, 'error');
    const validFiles: Array<{ file: File; extension: ImageExtension }> = [];
    for (const file of files.slice(0, room)) {
      const error = validateImageFile(file);
      const extension = imageExtensionForType(file.type);
      if (error || !extension) {
        onToast?.(error || `不支持的图片格式: ${file.name}`, 'error');
        continue;
      }
      validFiles.push({ file, extension });
    }
    if (!validFiles.length) return;
    setReadingImages(true);
    try {
      const nextImages = await Promise.all(validFiles.map(({ file, extension }) => readPendingImage(file, extension)));
      setPendingImages(current => [...current, ...nextImages].slice(0, MAX_COMPOSER_IMAGES));
    } catch (cause) {
      onToast?.(`读取图片失败: ${errorMessage(cause)}`, 'error');
    } finally {
      setReadingImages(false);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    if (mode !== 'memo') {
      onToast?.('截图仅支持短笔记', 'error');
      return;
    }
    void addImages(files);
  };

  const handleDrop = (event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    if (mode !== 'memo') {
      onToast?.('截图仅支持短笔记', 'error');
      return;
    }
    void addImages(event.dataTransfer.files);
  };

  const handleDragOver = (event: React.DragEvent<HTMLFormElement>) => {
    if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (readingImages) {
      onToast?.('图片仍在读取，请稍候保存', 'error');
      return;
    }
    const trimmedFront = front.trim();
    const trimmedBack = back.trim();
    if (!trimmedFront && !(mode === 'memo' && pendingImages.length)) {
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
      const selectedDeck = mode === 'memo' ? MEMO_DECK : preferences.qa.deck;
      if (!selectedDeck) throw new Error('请先选择牌组');
      if (mode === 'memo' && !decks.includes(MEMO_DECK)) {
        await client.createDeck(MEMO_DECK);
        setDecks(current => current.includes(MEMO_DECK) ? current : [...current, MEMO_DECK]);
      }
      let names = fieldNames;
      if (!names.length) names = await client.modelFieldNames(model);
      if (!names.length) throw new Error('当前模板没有可用字段');
      if (mode === 'qa' && names.length < 2) throw new Error('问答模式需要至少两个字段');
      const result = await writeComposerNote(client, {
        deck: selectedDeck,
        model,
        fieldNames: names,
        front,
        back,
        mode,
        tags: tags.trim().split(/\s+/).filter(Boolean),
        images: pendingImages
      });
      if ('error' in result) {
        onToast?.(result.error, 'error');
        return;
      }
      noteId = result.noteId;
      if (mode === 'memo') await suspendMemoNote(client, noteId);
      saveComposerPreference(mode, preferences);
      setFront('');
      setBack('');
      if (mode === 'memo') setPendingImages([]);
      onToast?.(mode === 'memo' ? '短笔记已保存，已暂停' : '问答卡片已保存');
      try {
        await onCreated?.(noteId);
      } catch (cause) {
        onToast?.(`已保存，但列表刷新失败: ${errorMessage(cause)}`, 'error');
      }
    } catch (cause) {
      const message = noteId !== null && mode === 'memo'
        ? `短笔记已创建，但暂停失败（note id: ${noteId}）：${errorMessage(cause)}`
        : `保存失败: ${errorMessage(cause)}`;
      onToast?.(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isMemo = mode === 'memo';
  return (
    <form
      id="inputCard"
      className={`input-card ${isMemo ? 'memo-mode' : 'qa-mode'}`}
      aria-labelledby="composerTitle"
      onSubmit={create}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input id="noteModeMemo" className="visually-hidden" type="radio" name="noteMode" value="memo" aria-describedby="modeDescription" checked={isMemo} disabled={saving || readingImages} onChange={() => setMode('memo')} />
      <input id="noteModeQa" className="visually-hidden" type="radio" name="noteMode" value="qa" aria-describedby="modeDescription" checked={!isMemo} disabled={saving || readingImages} onChange={() => setMode('qa')} />
      <div className="composer-head">
        <h2 id="composerTitle">快速记录</h2>
        <div className="mode-switch" role="group" aria-label="笔记类型" aria-describedby="modeDescription">
          <label className={`mode-label ${isMemo ? 'active' : ''}`} htmlFor="noteModeMemo">短笔记</label>
          <label className={`mode-label ${!isMemo ? 'active' : ''}`} htmlFor="noteModeQa">问答卡</label>
        </div>
      </div>
      <p id="modeDescription" className="composer-hint">{isMemo ? '短笔记会保存到 Ankimo 牌组，保存后暂停，不进入日常复习。' : '问答卡会保留所选牌组，正常参与 Anki 日常复习。'}</p>
      <div className="composer-fields">
        <textarea id="frontInput" value={front} disabled={saving} onChange={event => setFront(event.target.value)} placeholder={isMemo ? '现在的想法是…' : '正面 / 问题...'} aria-label={isMemo ? '笔记内容' : '问题'} />
        <textarea id="backInput" value={back} onChange={event => setBack(event.target.value)} placeholder={isMemo ? '' : '背面 / 答案...'} aria-label={isMemo ? '笔记模式不使用答案' : '答案'} disabled={isMemo || saving} aria-hidden={isMemo} />
      </div>
      {isMemo && <div className="composer-images">
        <input
          id="imageInput"
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={saving || readingImages}
          onChange={event => {
            void addImages(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
        <label className="composer-image-dropzone" htmlFor="imageInput">
          <span>粘贴、拖入或选择截图</span>
          <small>PNG、JPEG、WebP · 最多 {MAX_COMPOSER_IMAGES} 张 · 单张不超过 10MB</small>
        </label>
        {pendingImages.length > 0 && <div className="composer-image-previews" aria-label="待上传截图">
          {pendingImages.map((image, index) => <figure className="composer-image-preview" key={image.id}>
            <img src={image.dataUrl} alt={image.name || `截图 ${index + 1}`} />
            <button
              type="button"
              className="composer-image-remove"
              disabled={saving || readingImages}
              aria-label={`移除 ${image.name || `截图 ${index + 1}`}`}
              onClick={() => setPendingImages(current => current.filter(item => item.id !== image.id))}
            >移除</button>
          </figure>)}
        </div>}
      </div>}
      <input id="advancedToggle" className="visually-hidden" type="checkbox" checked={advanced} disabled={saving} onChange={event => setAdvanced(event.target.checked)} />
      <div className="composer-footer">
        <div className="tag-input-wrap">
          <TagInput id="tagInput" value={tags} allTags={allTags} disabled={saving} onChange={nextTags => {
            setPreferences(current => mode === 'memo'
              ? { ...current, memo: { ...current.memo, tags: nextTags } }
              : { ...current, qa: { ...current.qa, tags: nextTags } });
          }} placeholder="添加标签，用空格分隔" />
        </div>
        <div className="composer-actions">
          <label className="advanced-toggle" htmlFor="advancedToggle">高级设置 <span className="advanced-chevron" aria-hidden="true"><svg viewBox="0 0 12 7" width="12" height="7" focusable="false"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg></span></label>
          <button id="saveBtn" className="save-btn" type="submit" disabled={saving || readingImages || loading || loadingFields}>{saving ? '保存中...' : readingImages ? '读取图片...' : '保存'}</button>
        </div>
      </div>
      <div className="advanced-controls">
        <label className="control-field" htmlFor="deckSelect">牌组
          <select id="deckSelect" value={isMemo ? MEMO_DECK : preferences.qa.deck} disabled={isMemo || loading || saving} onChange={event => {
            const nextDeck = event.target.value;
            setPreferences(current => ({ ...current, qa: { ...current.qa, deck: nextDeck } }));
          }}>
            {isMemo && !decks.includes(MEMO_DECK) && <option value={MEMO_DECK}>{MEMO_DECK}</option>}
            {decks.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="control-field" htmlFor="modelSelect">模板
          <select id="modelSelect" value={model} disabled={loading || saving} onChange={event => {
            const nextModel = event.target.value;
            setPreferences(current => mode === 'memo'
              ? { ...current, memo: { ...current.memo, model: nextModel } }
              : { ...current, qa: { ...current.qa, model: nextModel } });
          }}>
            {models.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
    </form>
  );
}
