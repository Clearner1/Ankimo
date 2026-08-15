import { describe, expect, it } from 'vitest';
import { closeAfterCreated } from './NewNoteDialog';
import { NewNoteDialog } from './index';

describe('NewNoteDialog close behavior', () => {
  it('closes after the refresh callback settles, including refresh errors', async () => {
    const changes: boolean[] = [];

    expect(NewNoteDialog).toBeTypeOf('function');

    await expect(closeAfterCreated(async () => {
      throw new Error('refresh failed');
    }, 7, open => changes.push(open))).rejects.toThrow('refresh failed');

    expect(changes).toEqual([false]);
  });
});
