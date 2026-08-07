import { useEffect, useState } from 'react';
import type { NoteInfo } from '../../api/ankiConnect';
import { AnkiConnect } from '../../api/ankiConnect';
import { noteFieldValue } from '../../domain/notes';

export type EditModalApi = Pick<AnkiConnect, 'notesInfo' | 'updateNote'>;
export type Toast = (message: string, type?: 'success' | 'error') => void;
export type EditModalProps = {
  noteId: number | null;
  client?: EditModalApi;
  onClose: () => void;
  onUpdated?: (noteId: number) => void | Promise<void>;
  onToast?: Toast;
};

const defaultClient = new AnkiConnect();

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function EditModal({ noteId, client = defaultClient, onClose, onUpdated, onToast }: EditModalProps) {
  const [note, setNote] = useState<NoteInfo | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (noteId === null) {
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return undefined;
      setLoading(true);
      setError(null);
      setNote(null);
      return client.notesInfo([noteId]);
    }).then(notes => {
      if (!active) return;
      if (!notes) return;
      const next = notes[0];
      if (!next) throw new Error('未找到笔记');
      setNote(next);
      setFields(Object.fromEntries(Object.entries(next.fields).map(([name, field]) => [name, noteFieldValue(field)])));
      setTags((next.tags || []).join(' '));
    }).catch(cause => {
      if (active) setError(errorMessage(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, noteId]);

  const save = async () => {
    if (noteId === null || saving || !note) return;
    setSaving(true);
    try {
      await client.updateNote(noteId, fields, tags.trim().split(/\s+/).filter(Boolean));
      await onUpdated?.(noteId);
      onToast?.('笔记已更新');
      onClose();
    } catch (cause) {
      onToast?.(`保存失败: ${errorMessage(cause)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (noteId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const open = noteId !== null;
  return (
    <div
      id="editModalOverlay"
      className="edit-modal-overlay"
      role="presentation"
      style={{ display: open ? 'grid' : 'none' }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
        <div className="edit-modal-header">
          <h3 id="editModalTitle">编辑笔记</h3>
          <div id="editModalMeta" className="edit-modal-meta">
            {note?.modelName && <span className="edit-meta-chip">模板：{note.modelName}</span>}
            {note && <span className="edit-meta-chip">note：{note.noteId}</span>}
          </div>
        </div>
        <div id="editModalBody" className="edit-modal-body">
          {loading && <div className="edit-loading">加载中...</div>}
          {!loading && error && <div className="edit-loading">加载失败: {error}</div>}
          {!loading && !error && Object.entries(fields).map(([name, value]) => (
            <div className="edit-field-group" key={name}>
              <label className="edit-field-label" htmlFor={`edit-field-${name}`}>{name}</label>
              <textarea
                id={`edit-field-${name}`}
                className="edit-field-textarea"
                rows={3}
                value={value}
                onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="edit-modal-tags">
          <label htmlFor="editTagsInput">标签 <span className="edit-tags-hint">（空格分隔）</span></label>
          <input id="editTagsInput" value={tags} onChange={event => setTags(event.target.value)} />
        </div>
        <div className="edit-modal-actions">
          <button id="editModalCancel" className="edit-modal-cancel" type="button" onClick={onClose}>取消</button>
          <button id="editModalSave" className="edit-modal-save" type="button" disabled={saving || loading || !note} onClick={() => void save()}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
