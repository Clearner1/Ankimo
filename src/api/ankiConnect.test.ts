import { describe, expect, it } from 'vitest';
import { AnkiConnect } from './ankiConnect';

describe('AnkiConnect', () => {
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
