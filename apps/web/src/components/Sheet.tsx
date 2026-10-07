import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { cx, IconButton } from './ui.tsx';

/**
 * A panel over the page: rises from the bottom on phones, sits centred on wider
 * screens. Escape, the close button or a click outside close it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-end bg-scrim md:items-start md:justify-center md:pt-[8vh]"
    >
      <Modal
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-sheet border border-line bg-surface shadow-float md:max-h-[84vh] md:max-w-[640px] md:rounded-sheet',
          className,
        )}
      >
        <Dialog className="flex min-h-0 flex-1 flex-col outline-none">
          <div className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <Heading slot="title" className="text-[1.15rem] font-bold [font-stretch:75%]">
                {title}
              </Heading>
              {subtitle && <p className="text-[0.85rem] text-ink-muted">{subtitle}</p>}
            </div>
            <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} className="-mr-1.5 -mt-0.5" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] sm:px-5">
              {footer}
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
