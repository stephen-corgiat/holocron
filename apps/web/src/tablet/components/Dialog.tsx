import { ReactNode, useEffect } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = 560,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="tb-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="tb-dialog"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {(eyebrow || title) && (
          <header className="tb-dialog-header">
            {eyebrow && <div className="tb-dialog-eyebrow">{eyebrow}</div>}
            {title && <div className="tb-dialog-title">{title}</div>}
          </header>
        )}
        <div className="tb-dialog-body">{children}</div>
        {footer && <footer className="tb-dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}
