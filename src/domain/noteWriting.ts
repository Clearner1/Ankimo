import type { AnkiConnect } from '../api/ankiConnect';

export type NoteMode = 'memo' | 'qa';

export const MEMO_MODEL = 'XXHK - 划线';
export const QA_MODEL = 'XXHK - 问答';

type NoteClient = Pick<AnkiConnect, 'modelFieldNames' | 'addNote' | 'findCards' | 'suspend' | 'areSuspended'>;

export function noteTextToHtml(value: string): string {
  if (!value) return '';
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<span style="white-space: pre-wrap">${escaped}</span>`;
}

export function buildNoteFields(fieldNames: readonly string[], front: string, back: string, mode: NoteMode): Record<string, string> {
  return Object.fromEntries(fieldNames.map((name, index) => [name, index === 0 ? front : mode === 'qa' && index === 1 ? back : '']));
}

async function findNoteCards(client: Pick<AnkiConnect, 'findCards'>, noteId: number, attempts = 3, delayMs = 120): Promise<number[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const cards = await client.findCards(`nid:${noteId}`);
    if (cards.length) return cards;
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return [];
}

export async function suspendMemoNote(client: Pick<AnkiConnect, 'findCards' | 'suspend' | 'areSuspended'>, noteId: number): Promise<void> {
  const cards = await findNoteCards(client, noteId);
  if (!cards.length) throw new Error(`已创建 note ${noteId}，但没有找到对应卡片，无法确认暂停状态`);
  await client.suspend(cards);
  const suspended = await client.areSuspended(cards);
  if (suspended.length !== cards.length || !suspended.every(Boolean)) {
    throw new Error(`已创建 note ${noteId}，但回读确认并非所有卡片都已暂停`);
  }
}

export async function createTextNote(client: NoteClient, input: {
  deck: string;
  model: string;
  front: string;
  back?: string;
  mode: NoteMode;
  tags?: string[];
}): Promise<number> {
  const fieldNames = await client.modelFieldNames(input.model);
  if (!fieldNames.length) throw new Error('当前模板没有可用字段');
  if (input.mode === 'qa' && fieldNames.length < 2) throw new Error('问答模式需要至少两个字段');
  const noteId = await client.addNote(
    input.deck,
    input.model,
    buildNoteFields(fieldNames, noteTextToHtml(input.front), noteTextToHtml(input.back || ''), input.mode),
    input.tags || []
  );
  if (!noteId) throw new Error('AnkiConnect 没有返回 note id，无法确认创建结果');
  if (input.mode === 'memo') await suspendMemoNote(client, noteId);
  return noteId;
}
