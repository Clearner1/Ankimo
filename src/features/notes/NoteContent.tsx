import { useEffect, useMemo, useState, type HTMLAttributes } from 'react';
import { AnkiConnect } from '../../api/ankiConnect';
import { noteFieldValue } from '../../domain/notes';

export type NoteContentClient = Pick<AnkiConnect, 'retrieveMediaFileBase64'>;

export type NoteContentProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: unknown;
  client?: NoteContentClient;
};

type PreparedMediaHtml = {
  html: string;
  filenames: string[];
};

const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;
const SRC_ATTRIBUTE_PATTERN = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const MEDIA_INDEX_PATTERN = /\sdata-ankimo-media-index="(\d+)"/i;
const MEDIA_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const defaultClient = new AnkiConnect();

export function sanitizeHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function relativeMediaFilename(value: string): string | null {
  const filename = value.trim();
  if (!filename || /[/\\]/.test(filename) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(filename)) return null;
  return filename;
}

export function mediaMimeType(filename: string): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const extension = filename.split(/[?#]/, 1)[0].toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return null;
}

export function mediaDataUrl(filename: string, base64: string | null): string | null {
  const mime = mediaMimeType(filename);
  const data = base64?.replace(/\s/g, '') || '';
  return mime && data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data) ? `data:${mime};base64,${data}` : null;
}

export function prepareMediaHtml(html: string): PreparedMediaHtml {
  const filenames: string[] = [];
  const preparedHtml = html.replace(IMAGE_TAG_PATTERN, tag => {
    const source = tag.match(SRC_ATTRIBUTE_PATTERN);
    const filename = source ? relativeMediaFilename(source[1] || source[2] || source[3] || '') : null;
    if (!filename || !mediaMimeType(filename)) return tag;

    const index = filenames.push(filename) - 1;
    return tag.replace(SRC_ATTRIBUTE_PATTERN, `src="${MEDIA_PLACEHOLDER}" data-ankimo-media-index="${index}"`);
  });
  return { html: preparedHtml, filenames };
}

export function applyMediaDataUrls(html: string, dataUrls: readonly (string | null)[]): string {
  return html.replace(IMAGE_TAG_PATTERN, tag => {
    const index = tag.match(MEDIA_INDEX_PATTERN)?.[1];
    const dataUrl = index === undefined ? null : dataUrls[Number(index)];
    if (!dataUrl) return tag;
    return tag
      .replace(SRC_ATTRIBUTE_PATTERN, `src="${dataUrl}"`)
      .replace(MEDIA_INDEX_PATTERN, '');
  });
}

type RenderedContent = {
  source: string;
  client: NoteContentClient;
  html: string;
};

export function NoteContent({ value, client = defaultClient, ...props }: NoteContentProps) {
  const source = sanitizeHtml(noteFieldValue(value));
  const prepared = useMemo(() => prepareMediaHtml(source), [source]);
  const [rendered, setRendered] = useState<RenderedContent>(() => ({ source, client, html: prepared.html }));

  useEffect(() => {
    let active = true;

    if (prepared.filenames.length === 0) return () => { active = false; };

    void Promise.all(prepared.filenames.map(async filename => {
      try {
        return mediaDataUrl(filename, await client.retrieveMediaFileBase64(filename));
      } catch {
        return null;
      }
    })).then(dataUrls => {
      if (active) setRendered({ source, client, html: applyMediaDataUrls(prepared.html, dataUrls) });
    });

    return () => { active = false; };
  }, [client, prepared, source]);

  const html = rendered.source === source && rendered.client === client ? rendered.html : prepared.html;
  return <div {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}
