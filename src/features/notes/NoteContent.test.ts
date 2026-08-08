import { describe, expect, it } from 'vitest';
import { applyMediaDataUrls, mediaDataUrl, prepareMediaHtml, relativeMediaFilename, sanitizeHtml } from './NoteContent';

describe('sanitizeHtml', () => {
  it('keeps ordinary Anki markup while removing scripts and event handlers', () => {
    expect(sanitizeHtml('<p onclick="alert(1)">ok</p><script>alert(2)</script><img onerror=bad>')).toBe('<p>ok</p><img>');
  });
});

describe('Anki media html', () => {
  it('only prepares relative PNG/JPEG/WebP sources and restores successful data URLs', () => {
    const prepared = prepareMediaHtml('<p>text</p><img src="note.png"><img src="photo.JPG"><img src="https://example.com/remote.webp"><img src="data:image/png;base64,abc"><img src="icon.svg">');

    expect(prepared.filenames).toEqual(['note.png', 'photo.JPG']);
    expect(prepared.html).toContain('src="data:image/gif;base64,');
    expect(prepared.html).toContain('src="https://example.com/remote.webp"');
    expect(applyMediaDataUrls(prepared.html, [mediaDataUrl('note.png', 'cG5nLWRhdGE='), null])).toContain('src="data:image/png;base64,cG5nLWRhdGE="');
    expect(mediaDataUrl('photo.JPG', 'anBlZy1kYXRh')).toBe('data:image/jpeg;base64,anBlZy1kYXRh');
  });

  it('rejects absolute and non-relative media sources', () => {
    expect(relativeMediaFilename('data:image/png;base64,abc')).toBeNull();
    expect(relativeMediaFilename('https://example.com/image.png')).toBeNull();
    expect(relativeMediaFilename('/images/image.png')).toBeNull();
    expect(relativeMediaFilename('C:\\images\\image.png')).toBeNull();
    expect(relativeMediaFilename('../image.png')).toBeNull();
    expect(relativeMediaFilename('folder/image.png')).toBeNull();
    expect(relativeMediaFilename('image.webp')).toBe('image.webp');
    expect(mediaDataUrl('image.png', 'not-an-image"')).toBeNull();
  });
});
