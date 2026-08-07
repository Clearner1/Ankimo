import { useState, type KeyboardEvent } from 'react';
import type { NoteInfo } from '../../api/ankiConnect';
import { isBlankHtml } from '../../domain/notes';
import { NoteContent } from './NoteContent';

export type NoteCardProps = {
  note: NoteInfo;
  blurAnswers?: boolean;
  onEdit?: (noteId: number) => void;
  onDelete?: (noteId: number) => void | Promise<void>;
  onTagClick?: (tag: string) => void;
};

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function activate(event: KeyboardEvent, callback: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    callback();
  }
}

export function NoteCard({ note, blurAnswers = true, onEdit, onDelete, onTagClick }: NoteCardProps) {
  const fields = Object.entries(note.fields || {}).slice(0, 2);
  const front = fields[0]?.[1] ?? '';
  const back = fields[1]?.[1] ?? '';
  const hasAnswer = !isBlankHtml(back);
  const [revealed, setRevealed] = useState(!blurAnswers);

  const toggleAnswer = () => {
    if (blurAnswers) setRevealed(value => !value);
  };
  const answerBlurred = blurAnswers && !revealed;
  const modified = note.mod ? new Date(note.mod * 1000) : null;
  const validModified = modified && !Number.isNaN(modified.getTime()) ? modified : null;

  return (
    <article className="note-card" data-note-id={note.noteId}>
      <div className="note-actions">
        {onEdit && <button className="edit-btn" data-id={note.noteId} type="button" aria-label={`编辑笔记 ${note.noteId}`} onClick={() => onEdit(note.noteId)}>编辑</button>}
        {onDelete && <button className="delete-btn" data-id={note.noteId} type="button" aria-label={`删除笔记 ${note.noteId}`} onClick={() => { if (window.confirm('确定删除这条笔记吗？')) void onDelete(note.noteId); }}>删除</button>}
      </div>
      <div className="note-field">
        <div className="note-field-label">{hasAnswer ? '问题' : '笔记'}</div>
        <NoteContent className="note-field-content" value={front} />
      </div>
      {hasAnswer && (
        <div className="note-field answer-field">
          <div className="note-field-label">答案</div>
          <NoteContent
            className={`note-field-content ${answerBlurred ? 'blurred' : 'revealed'}`}
            value={back}
            data-answer-reveal="true"
            role={blurAnswers ? 'button' : undefined}
            tabIndex={blurAnswers ? 0 : undefined}
            aria-expanded={!answerBlurred}
            aria-label={blurAnswers ? answerBlurred ? '显示答案' : '隐藏答案' : '答案已显示'}
            onClick={blurAnswers ? toggleAnswer : undefined}
            onKeyDown={blurAnswers ? event => activate(event, toggleAnswer) : undefined}
          />
        </div>
      )}
      <div className="note-meta">
        {(note.tags || []).map(tag => (
          <span
            className="note-tag"
            data-tag={tag}
            key={tag}
            role={onTagClick ? 'button' : undefined}
            tabIndex={onTagClick ? 0 : undefined}
            aria-label={onTagClick ? `按标签筛选 ${tag}` : undefined}
            onClick={() => onTagClick?.(tag)}
            onKeyDown={event => onTagClick && activate(event, () => onTagClick(tag))}
          >{tag}</span>
        ))}
        <span className={`note-type ${hasAnswer ? 'note-type-qa' : 'note-type-memo'}`}>{hasAnswer ? '问答卡' : '不复习'}</span>
        {note.modelName && <span className="note-model">模板：{note.modelName}</span>}
        {validModified ? <time className="note-time" dateTime={validModified.toISOString()}>{formatDate(validModified)}</time> : <span className="note-time" />}
      </div>
    </article>
  );
}
