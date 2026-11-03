'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from './cn';

/**
 * Mount → open → closing → unmounted, so exit transitions can play.
 * Closing is shorter than opening (150 vs 250 ms), as the motion tokens say.
 *
 * Mounted whenever `open` is true, and kept mounted (`lingering`) through the
 * exit. State only changes from timer/frame callbacks, never during render,
 * so React's dev double-rendering can't lose an update. Reopening while the
 * exit plays just reverses the CSS transition.
 */
export function usePresence(open: boolean, closeMs = 150) {
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

/** Anchored panel that grows from its trigger. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  label: string;
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
      className={cn(
        // Phones: full width under the bar (a narrow trigger can sit anywhere in it).
        // Desktop: anchored under its trigger.
        't-dropdown fixed inset-x-3 top-[calc(var(--bar-h)+var(--safe-t)+6px)] z-50 rounded-2xl bg-sheet ring-seam shadow-[0_18px_40px_rgba(0,0,0,0.55)] lg:absolute lg:inset-x-auto lg:right-0 lg:top-[calc(100%+8px)] lg:w-[320px]',
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
 * page behind is inert. Bottom sheet on phones, centred panel on desktop.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { mounted, shown, closing } = usePresence(open);

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
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-transparent"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn('scrim fixed inset-0', shown && !closing && 'is-open')} aria-hidden onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 flex items-end justify-center lg:items-center">
        <div
          className={cn(
            't-modal pointer-events-auto relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-sheet p-5 pb-[calc(20px+var(--safe-b))] ring-seam lg:max-w-[460px] lg:rounded-3xl lg:p-7',
            shown && !closing && 'is-open',
            closing && 'is-closing',
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="title-s text-[20px]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="press -mr-2 -mt-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-dropout-text hover:text-mark"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </dialog>
  );
}
