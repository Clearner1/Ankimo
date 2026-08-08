import { useCallback, useEffect, useState } from 'react';
import type { AnkiConnect } from '../../api/ankiConnect';

export const PINNED_TAGS_CONFIG_FILE = '_ankimo_config.json';
export type PinnedTagsClient = Pick<AnkiConnect, 'retrieveMediaFile' | 'storeMediaFile'>;

function getStorage(storage?: Storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function decodePinnedTags(value: string | null) {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  const tags = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'pinnedTags' in parsed
      ? (parsed as { pinnedTags?: unknown }).pinnedTags
      : [];
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

export function parsePinnedTags(value: string | null) {
  try {
    return decodePinnedTags(value);
  } catch {
    return [];
  }
}

export async function loadPinnedTags(client: PinnedTagsClient, storage?: Storage) {
  try {
    const data = await client.retrieveMediaFile(PINNED_TAGS_CONFIG_FILE);
    if (data) return decodePinnedTags(data);
  } catch (error) {
    console.warn('Load pinned tags from Anki failed, using localStorage fallback', error);
  }
  return parsePinnedTags(getStorage(storage)?.getItem('ankimo_pinned_tags') || null);
}

export async function savePinnedTags(client: PinnedTagsClient, pinnedTags: readonly string[], storage?: Storage) {
  const tags = pinnedTags.filter((tag): tag is string => typeof tag === 'string');
  try {
    getStorage(storage)?.setItem('ankimo_pinned_tags', JSON.stringify(tags));
  } catch (error) {
    console.warn('Save pinned tags to localStorage failed', error);
  }
  try {
    await client.storeMediaFile(PINNED_TAGS_CONFIG_FILE, JSON.stringify({ pinnedTags: tags }));
  } catch (error) {
    console.warn('Save pinned tags to Anki failed', error);
  }
}

export function usePinnedTags(client: PinnedTagsClient) {
  const [pinnedTags, setPinnedTags] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    void loadPinnedTags(client).then((tags) => {
      if (current) setPinnedTags(tags);
    });
    return () => { current = false; };
  }, [client]);

  const togglePinnedTag = useCallback((tag: string) => {
    setPinnedTags((current) => {
      const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
      void savePinnedTags(client, next);
      return next;
    });
  }, [client]);

  return { pinnedTags, togglePinnedTag };
}
