'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from './cn';

/**
 * Mount → open → closing → unmounted, so exit transitions can play.
 *
 * Mounted whenever `open` is true, and kept mounted (`lingering`) through the
 * exit. State only changes from timer/frame callbacks, never during render,
 * so React's dev double-rendering can't lose an update. Reopening while the
 * exit plays just reverses the CSS transition.
 */
export function usePresence(open: boolean, closeMs = 160) {
  const [lingering, setLingering] = useState(open);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (open) {
      // Two frames so the closed styles paint before the open class lands.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setLingering(true);
          setEntered(true);
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    const t = window.setTimeout(() => {
      setLingering(false);
      setEntered(false);
    }, closeMs);
    return () => window.clearTimeout(t);
  }, [open, closeMs]);
  const mounted = open || lingering;
  return { mounted, shown: open && entered, closing: !open && lingering };
}

/** Anchored glass panel that grows from its trigger (downward from a bar, upward from the sidebar's foot). */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  className,
  label,
  placement = 'down',
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  label: string;
  placement?: 'down' | 'up';
}) {
  const { mounted, shown, closing } = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchor.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  useEffect(() => {
    if (shown) panel.current?.querySelector<HTMLElement>('[data-autofocus], button, a, input')?.focus({ preventScroll: true });
  }, [shown]);

  if (!mounted) return null;
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      data-side={placement}
      className={cn(
        't-dropdown z-50 overflow-hidden rounded-[22px] bg-[#161618]/95 shadow-[0_24px_64px_rgba(0,0,0,0.7)] hair backdrop-blur-2xl lg lg-card lg-frost',
        placement === 'down'
          ? // Phones: full width under the bar (a narrow trigger can sit anywhere in it).
            'fixed inset-x-3 top-[calc(var(--bar-h)+var(--safe-t)+6px)] lg:absolute lg:inset-x-auto lg:right-0 lg:top-[calc(100%+8px)] lg:w-[340px]'
          : 'absolute bottom-[calc(100%+8px)] left-0 w-[320px]',
        shown && !closing && 'is-open',
        closing && 'is-closing',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Modal sheet on a native <dialog>: focus is trapped, Escape closes it, the
 * page behind is inert. Rises from the bottom edge on phones, a centred panel
 * on desktop.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** A wider panel on desktop. */
  wide?: boolean;
  /** No visible heading row (the content brings its own); the title still names the dialog. */
  bare?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { mounted, shown, closing } = usePresence(open, 230);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (mounted && !d.open) d.showModal();
  }, [mounted]);

  // Close the native dialog just before it leaves the DOM, so the browser
  // hands focus back to whatever opened it.
  useLayoutEffect(() => {
    const d = ref.current;
    return () => {
      if (d?.open) d.close();
    };
  }, [mounted]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);

  if (!mounted) return null;
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-transparent"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn('scrim fixed inset-0', shown && !closing && 'is-open')} aria-hidden onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 flex items-end justify-center lg:items-center lg:p-6">
        <div
          className={cn(
            't-modal pointer-events-auto relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] bg-sheet px-5 pb-[calc(22px+var(--safe-b))] pt-2.5 shadow-[0_-12px_60px_rgba(0,0,0,0.6)] hair lg:rounded-[28px] lg:px-7 lg:pb-7 lg:pt-6 lg lg-card lg-frost',
            wide ? 'lg:max-w-[560px]' : 'lg:max-w-[460px]',
            shown && !closing && 'is-open',
            closing && 'is-closing',
          )}
        >
          <div className="mx-auto mb-3 grabber lg:hidden" aria-hidden />
          <div className={cn('flex items-start justify-between gap-4', bare ? 'absolute right-3 top-3 z-10 lg:right-4 lg:top-4' : 'mb-5')}>
            {!bare && <h2 className="h2 text-[21px]">{title}</h2>}
            <button
              type="button"
              onClick={onClose}
              className={cn('icon-btn press shrink-0 lg lg-btn', !bare && '-mr-1')}
              aria-label="Close"
            >
              <X size={17} weight="bold" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </dialog>
  );
}
