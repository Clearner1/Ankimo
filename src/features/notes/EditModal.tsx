import { useEffect, useState } from 'react';
import type { NoteInfo } from '../../api/ankiConnect';
import { AnkiConnect } from '../../api/ankiConnect';
import { noteFieldValue } from '../../domain/notes';
import { Dialog, TagInput } from '../../ui';
import styles from './EditModal.module.css';

export type EditModalApi = Pick<AnkiConnect, 'notesInfo' | 'updateNote'>;
export type Toast = (message: string, type?: 'success' | 'error') => void;
export type EditModalProps = {
  noteId: number | null;
  client?: EditModalApi;
  allTags?: readonly string[];
  onClose: () => void;
  onUpdated?: (noteId: number) => void | Promise<void>;
  onToast?: Toast;
};

const defaultClient = new AnkiConnect();

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function EditModal({ noteId, client = defaultClient, allTags = [], onClose, onUpdated, onToast }: EditModalProps) {
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
    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop id="editModalOverlay" className={`edit-modal-overlay ${styles.overlay}`} role="presentation" />
        <Dialog.Viewport className={`edit-modal-viewport ${styles.viewport}`}>
          <Dialog.Popup className={`edit-modal ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
            <div className={`edit-modal-header ${styles.header}`}>
              <Dialog.Title id="editModalTitle" className={`edit-modal-title ${styles.headerTitle}`} render={<h3 />}>编辑笔记</Dialog.Title>
              <div id="editModalMeta" className={`edit-modal-meta ${styles.meta}`}>
                {note?.modelName && <span className={`edit-meta-chip ${styles.metaChip}`}>模板：{note.modelName}</span>}
                {note && <span className={`edit-meta-chip ${styles.metaChip}`}>note：{note.noteId}</span>}
              </div>
            </div>
            <div id="editModalBody" className={`edit-modal-body ${styles.body}`}>
              {loading && <div className={`edit-loading ${styles.loading}`}>加载中...</div>}
              {!loading && error && <div className={`edit-loading ${styles.loading}`}>加载失败: {error}</div>}
              {!loading && !error && Object.entries(fields).map(([name, value]) => (
                <div className={`edit-field-group ${styles.fieldGroup}`} key={name}>
                  <label className={`edit-field-label ${styles.fieldLabel}`} htmlFor={`edit-field-${name}`}>{name}</label>
                  <textarea
                    id={`edit-field-${name}`}
                    className={`edit-field-textarea ${styles.fieldTextarea}`}
                    rows={3}
                    value={value}
                    onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className={`edit-modal-tags ${styles.tags}`}>
              <label className={styles.tagsLabel} htmlFor="editTagsInput">标签 <span className={`edit-tags-hint ${styles.tagsHint}`}>（空格分隔）</span></label>
              <TagInput id="editTagsInput" value={tags} allTags={allTags} disabled={saving} onChange={setTags} />
            </div>
            <div className={`edit-modal-actions ${styles.actions}`}>
              <Dialog.Close id="editModalCancel" className={`edit-modal-cancel ${styles.cancel}`} type="button">取消</Dialog.Close>
              <button id="editModalSave" className={`edit-modal-save ${styles.save}`} type="button" disabled={saving || loading || !note} onClick={() => void save()}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
