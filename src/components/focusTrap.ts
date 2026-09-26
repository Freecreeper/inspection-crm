const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert"));
}

// Keeps Tab / Shift+Tab cycling inside `container`. Call from a keydown
// handler; returns true when it handled the event.
export function trapTabKey(container: HTMLElement, event: KeyboardEvent | React.KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const items = focusableWithin(container);
  if (items.length === 0) {
    event.preventDefault();
    return true;
  }
  const firstItem = items[0];
  const lastItem = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === firstItem || !container.contains(active))) {
    event.preventDefault();
    lastItem.focus();
    return true;
  }
  if (!event.shiftKey && active === lastItem) {
    event.preventDefault();
    firstItem.focus();
    return true;
  }
  return false;
}
