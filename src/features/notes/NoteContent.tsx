import type { HTMLAttributes } from 'react';
import { noteFieldValue } from '../../domain/notes';

export type NoteContentProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: unknown;
};

export function sanitizeHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function NoteContent({ value, ...props }: NoteContentProps) {
  return <div {...props} dangerouslySetInnerHTML={{ __html: sanitizeHtml(noteFieldValue(value)) }} />;
}
