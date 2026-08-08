import { describe, expect, it } from 'vitest';
import { createBatchCoordinator } from './useNotes';

describe('notes batch coordination', () => {
  it('does not let an invalidated batch release its replacement', () => {
    const coordinator = createBatchCoordinator();
    const oldBatch = coordinator.acquire();

    coordinator.invalidate();
    const currentBatch = coordinator.acquire();

    expect(oldBatch).not.toBeNull();
    expect(currentBatch).not.toBeNull();
    expect(oldBatch?.()).toBe(false);
    expect(coordinator.acquire()).toBeNull();
    expect(currentBatch?.()).toBe(true);
    expect(coordinator.acquire()).not.toBeNull();
  });
});
