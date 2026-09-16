import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import type { IconName } from './icons';
import './Dialog.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  size?: 'md' | 'lg';
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** 포커스를 가두고 Esc로 닫히는 모달 */
export function Dialog({ open, title, onClose, children, footer, size = 'md' }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first =
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={handleKeyDown}>
      <div
        ref={panelRef}
        className={`dialog dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__footer">{footer}</div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmIcon?: IconName;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 순위 확정·교환처럼 되돌리기 어려운 동작 전에 한 번 더 묻는다. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmIcon = 'check',
  cancelLabel = '취소',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={loading ? () => undefined : onCancel}
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            onClick={onCancel}
            disabled={loading}
            data-autofocus
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone}
            size="lg"
            icon={confirmIcon}
            onClick={onConfirm}
            loading={loading}
            loadingLabel="처리 중"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
