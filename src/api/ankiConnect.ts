export type NoteField = { value: string; order?: number };
export type NoteFields = Record<string, NoteField | string>;
export type NoteInfo = {
  noteId: number;
  modelName?: string;
  fields: NoteFields;
  tags?: string[];
  mod?: number;
};
export type CardReview = [reviewTime: number, cardId: number, ...details: number[]];
export type ReviewCountByDay = [date: string, count: number];

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ClientOptions = { url?: string; fetch?: Fetcher };

function defaultUrl() {
  const hostname = typeof location === 'undefined' ? '' : location.hostname;
  return ['127.0.0.1', 'localhost'].includes(hostname) ? 'http://127.0.0.1:8765' : '/anki';
}

export class AnkiConnect {
  private readonly url: string;
  private readonly fetcher: Fetcher;

  constructor(options: ClientOptions = {}) {
    this.url = options.url || defaultUrl();
    this.fetcher = options.fetch || globalThis.fetch.bind(globalThis);
  }

  async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetcher(this.url, {
      method: 'POST',
      body: JSON.stringify({ action, version: 6, params })
    });
    if (!response.ok) throw new Error(`AnkiConnect 请求失败 (${response.status})`);
    const data: { result: T; error?: string | null } = await response.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  getTags() { return this.invoke<string[]>('getTags'); }
  findNotes(query: string) { return this.invoke<number[]>('findNotes', { query }); }
  findCards(query: string) { return this.invoke<number[]>('findCards', { query }); }
  cardsToNotes(cards: number[]) { return this.invoke<number[]>('cardsToNotes', { cards }); }
  // startID=0 is required to include historical reviews before local filtering.
  cardReviews(deck: string, startID = 0) { return this.invoke<CardReview[]>('cardReviews', { deck, startID }); }
  notesInfo(notes: number[]) { return this.invoke<NoteInfo[]>('notesInfo', { notes }); }
  addNote(deckName: string, modelName: string, fields: Record<string, string>, tags: string[] = []) {
    return this.invoke<number | null>('addNote', {
      note: { deckName, modelName, fields, tags, options: { allowDuplicate: true } }
    });
  }
  createDeck(deckName: string) { return this.invoke<string>('createDeck', { deck: deckName }); }
  suspend(cards: number[]) { return this.invoke<null>('suspend', { cards }); }
  areSuspended(cards: number[]) { return this.invoke<boolean[]>('areSuspended', { cards }); }
  deleteNotes(notes: number[]) { return this.invoke<null>('deleteNotes', { notes }); }
  updateNote(id: number, fields: Record<string, string>, tags: string[]) {
    return this.invoke<null>('updateNote', { note: { id, fields, tags } });
  }
  deckNames() { return this.invoke<string[]>('deckNames'); }
  modelNames() { return this.invoke<string[]>('modelNames'); }
  modelFieldNames(modelName: string) { return this.invoke<string[]>('modelFieldNames', { modelName }); }
  getNumCardsReviewedToday() { return this.invoke<number>('getNumCardsReviewedToday'); }
  getNumCardsReviewedByDay() { return this.invoke<ReviewCountByDay[]>('getNumCardsReviewedByDay'); }
  sync() { return this.invoke<unknown>('sync'); }
  storeMediaFile(filename: string, data: string) {
    return this.invoke<unknown>('storeMediaFile', { filename, data: btoa(unescape(encodeURIComponent(data))) });
  }
  async retrieveMediaFile(filename: string) {
    const result = await this.invoke<string | null>('retrieveMediaFile', { filename });
    return result ? decodeURIComponent(escape(atob(result))) : null;
  }
  storeMediaFileBase64(filename: string, base64Data: string) {
    return this.invoke<string | false | null>('storeMediaFile', { filename, data: base64Data });
  }
  async retrieveMediaFileBase64(filename: string) {
    const result = await this.invoke<string | false | null>('retrieveMediaFile', { filename });
    return result || null;
  }
  deleteMediaFile(filename: string) {
    return this.invoke<null>('deleteMediaFile', { filename });
  }
}
