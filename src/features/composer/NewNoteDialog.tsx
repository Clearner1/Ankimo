import { Dialog } from '../../ui';
import { Composer, type ComposerProps } from './Composer';
import styles from './NewNoteDialog.module.css';

export type NewNoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ComposerProps['client'];
  allTags?: ComposerProps['allTags'];
  onCreated?: ComposerProps['onCreated'];
  onToast?: ComposerProps['onToast'];
};

export async function closeAfterCreated(
  onCreated: ComposerProps['onCreated'],
  noteId: number,
  onOpenChange: (open: boolean) => void
): Promise<void> {
  try {
    await onCreated?.(noteId);
  } finally {
    onOpenChange(false);
  }
}

export function NewNoteDialog({ open, onOpenChange, client, allTags, onCreated, onToast }: NewNoteDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Viewport className={styles.viewport}>
          <Dialog.Popup className={styles.popup}>
            <Dialog.Title className={styles.title}>快速记录</Dialog.Title>
            <Dialog.Close className={styles.close} type="button" aria-label="关闭">
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
              </svg>
            </Dialog.Close>
            <Composer
              client={client}
              allTags={allTags}
              onCreated={noteId => closeAfterCreated(onCreated, noteId, onOpenChange)}
              onToast={onToast}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
