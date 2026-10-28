import { DialogSurface } from "@botiverse/raft-ui";
import CloseButton from "./CloseButton";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useLayoutEffect, useRef } from "react";
import { useIntl } from "react-intl";
import Modal from "../Modal";

/**
 * Product dialog shell for small forms (Create Agent, Add/Edit MCP, …) on the
 * shared Modal backdrop.
 *
 * Raft Design System › Dialog (`rf-dialog`): raft-ui's DialogSurface (the
 * popover layer, dialog radius, seam edge and float shadow, no motion) with
 * 20px padding, a sentence-case headline title (17/22 700) and a quiet ghost
 * close in the top right. The surface rather than raft-ui's Dialog parts
 * because these callers own the Modal lifecycle (backdrop / Escape / layer).
 */
export default function DialogCard({
  title,
  titleId,
  onClose,
  children,
  maxWidthClass = "max-w-md",
  testId,
  closeOnBackdrop = false,
  layer,
  trapFocus = false,
}: {
  title: ReactNode;
  titleId?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  testId?: string;
  /** Stacking tier forwarded to Modal (0 → z-50, 1 → z-60, >=2 → z-70).
   *  Needed when the card opens from inside another modal (for example the
   *  agent detail runtime editor) so it lands above the parent instead of
   *  behind it. */
  layer?: number;
  trapFocus?: boolean;
  /** Passed through because some callers close on backdrop and some must not.
   *  Without it, adopting this shell would silently take backdrop-close away
   *  from a dialog that had it — a behaviour change wearing a refactor's
   *  clothes. Defaults to the previous behaviour of this component. */
  closeOnBackdrop?: boolean;
}) {
  const { formatMessage } = useIntl();
  const generatedTitleId = useId();
  const headingId = titleId ?? generatedTitleId;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => {
    if (!trapFocus) return;
    const root = surfaceRef.current;
    if (!root) return;
    const previous = previousFocus.current;
    const focusable = () => [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter(node => !node.matches(':disabled, [tabindex="-1"]') && node.getClientRects().length > 0);
    if (!root.contains(document.activeElement)) (focusable()[0] ?? root).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const overlays = document.querySelectorAll('[data-slot="modal-backdrop"]');
      if (!overlays[overlays.length - 1]?.contains(root)) return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, [trapFocus]);
  return (
    <Modal onClose={onClose} closeOnBackdrop={closeOnBackdrop} {...(layer !== undefined ? { layer } : {})}>
      <DialogSurface
        ref={surfaceRef}
        role={trapFocus ? "dialog" : undefined}
        aria-modal={trapFocus ? true : undefined}
        aria-labelledby={trapFocus ? headingId : undefined}
        tabIndex={trapFocus ? -1 : undefined}
        data-slot="dialog-card"
        className={`w-full p-5 ${maxWidthClass}`}
        data-testid={testId}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 id={headingId} className="min-w-0 font-sans text-headline text-foreground">{title}</h2>
          <CloseButton
            type="button"
            size="icon-sm"
            onClick={onClose}
            aria-label={formatMessage({ id: "common.close" })}
            className="-my-1.5 -mr-1.5 shrink-0"
          >
            <X size={18} />
          </CloseButton>
        </div>
        {children}
      </DialogSurface>
    </Modal>
  );
}
