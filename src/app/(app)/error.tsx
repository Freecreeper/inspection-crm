"use client";

import Link from "next/link";

// Keeps the app shell (sidebar) when a page or action fails, instead of
// replacing the whole app. In production, server error messages are
// replaced with a generic one plus a reference that matches the server log.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  const message = error instanceof Error && process.env.NODE_ENV !== "production" ? error.message : null;
  return (
    <div role="alert" className="max-w-lg rounded-lg border border-warning-border bg-warning-soft p-5">
      <h1 className="text-base font-semibold text-amber-950">That didn&apos;t work</h1>
      <p className="mt-1 text-sm text-warning-strong">
        {message ?? "Something went wrong while loading or saving. Nothing else was changed. Try again, and if it keeps happening, share the reference below."}
      </p>
      {digest && <p className="mt-2 font-mono text-xs text-warning-strong">Reference: {digest}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => retry()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
          Try again
        </button>
        <Link href="/dashboard" className="rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover">
          Go to the Dashboard
        </Link>
      </div>
    </div>
  );
}
