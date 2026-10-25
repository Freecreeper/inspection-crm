"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself while its form's server action is
// running, so a double click (or a second tap on a slow connection) can't
// send the same action twice. Server actions still guard against repeats on
// their own; this just stops the obvious one.
export function SubmitButton({
  children,
  pendingLabel,
  className,
  confirm,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pendingLabel?: React.ReactNode; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      disabled={pending || rest.disabled}
      aria-disabled={pending || rest.disabled}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        rest.onClick?.(e);
      }}
      className={`${className ?? ""} disabled:cursor-wait disabled:opacity-60`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
