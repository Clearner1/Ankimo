export function noteFieldValue(field: unknown): string {
  if (field && typeof field === 'object') {
    return String((field as { value?: unknown }).value || '');
  }
  return String(field || '');
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'nbsp') return '\u00a0';
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : lower.startsWith('#') ? parseInt(lower.slice(1), 10) : NaN;
    if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    return match;
  });
}

export function isBlankHtml(value: unknown): boolean {
  const text = decodeHtmlEntities(noteFieldValue(value))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00a0/g, ' ');
  return text.trim() === '';
}
