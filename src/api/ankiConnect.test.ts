import { describe, expect, it } from 'vitest';
import { AnkiConnect } from './ankiConnect';

describe('AnkiConnect', () => {
  it('preserves UTF-8 text media semantics', async () => {
    const requests: Record<string, unknown>[] = [];
    const text = '置顶标签';
    const client = new AnkiConnect({
      url: '/anki',
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ result: requests.length === 1 ? null : btoa(unescape(encodeURIComponent(text))), error: null }), { status: 200 });
      }
    });

    await client.storeMediaFile('_ankimo.json', text);
    expect(await client.retrieveMediaFile('_ankimo.json')).toBe(text);
    expect(requests[0]).toMatchObject({
      action: 'storeMediaFile', version: 6,
      params: { filename: '_ankimo.json', data: btoa(unescape(encodeURIComponent(text))) }
    });
    expect(requests[1]).toMatchObject({
      action: 'retrieveMediaFile', version: 6, params: { filename: '_ankimo.json' }
    });
  });

  it('uses raw base64 media actions and normalizes missing media', async () => {
    const requests: Record<string, unknown>[] = [];
    const results: unknown[] = [false, 'image.png', false, '', null];
    const client = new AnkiConnect({
      url: '/anki',
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ result: results.shift(), error: null }), { status: 200 });
      }
    });

    expect(await client.storeMediaFileBase64('failed.png', 'bad')).toBe(false);
    expect(await client.storeMediaFileBase64('image.png', 'iVBORw0KGgo=')).toBe('image.png');
    expect(await client.retrieveMediaFileBase64('missing.png')).toBeNull();
    expect(await client.retrieveMediaFileBase64('empty.png')).toBeNull();
    await client.deleteMediaFile('image.png');

    expect(requests).toEqual([
      { action: 'storeMediaFile', version: 6, params: { filename: 'failed.png', data: 'bad' } },
      { action: 'storeMediaFile', version: 6, params: { filename: 'image.png', data: 'iVBORw0KGgo=' } },
      { action: 'retrieveMediaFile', version: 6, params: { filename: 'missing.png' } },
      { action: 'retrieveMediaFile', version: 6, params: { filename: 'empty.png' } },
      { action: 'deleteMediaFile', version: 6, params: { filename: 'image.png' } }
    ]);
  });

  it('keeps historical cardReviews startID at zero by default', async () => {
    let request = '';
    const client = new AnkiConnect({
      url: '/anki',
      fetch: async (_input, init) => {
        request = String(init?.body);
        return new Response(JSON.stringify({ result: [], error: null }), { status: 200 });
      }
    });

    await client.cardReviews('Ankimo');
    expect(JSON.parse(request)).toMatchObject({
      action: 'cardReviews', version: 6, params: { deck: 'Ankimo', startID: 0 }
    });
  });
});
