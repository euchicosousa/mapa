import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useContext, useRef, type ReactNode } from 'react';

const DialogLevel = createContext(0);

export function DraftDialog({
  open,
  onClose,
  title,
  description,
  children,
  closeLabel = 'Ficar nesta página',
  onReturnFocus,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  closeLabel?: string;
  onReturnFocus?: () => void;
  busy?: boolean;
}) {
  const level = useContext(DialogLevel);
  const returnTarget = useRef<HTMLElement | null>(null);
  return (
    <DialogLevel.Provider value={level + 1}>
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!value && !busy) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" style={{ zIndex: 100 + level * 2 }} />
          <Dialog.Content
            className="draft-dialog"
            style={{ zIndex: 101 + level * 2 }}
            onOpenAutoFocus={() => {
              returnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (onReturnFocus) onReturnFocus();
              else if (returnTarget.current?.isConnected) returnTarget.current.focus();
              else document.getElementById('conteudo')?.focus();
            }}
          >
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            <div className="draft-dialog-actions">{children}</div>
            <Dialog.Close disabled={busy} className="button button-secondary">
              {closeLabel}
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </DialogLevel.Provider>
  );
}
