"use client";

import Link from "next/link";

// Keeps the app shell (sidebar) when a page or action fails, instead of
// replacing the whole app. In production, server error messages are
// replaced with a generic one plus a reference that matches the server log.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  const message = error instanceof Error && process.env.NODE_ENV !== "production" ? error.message : null;
  return (
    <div role="alert" className="max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-5">
      <h1 className="text-base font-semibold text-amber-950">That didn&apos;t work</h1>
      <p className="mt-1 text-sm text-amber-900">
        {message ?? "Something went wrong while loading or saving. Nothing else was changed. Try again, and if it keeps happening, share the reference below."}
      </p>
      {digest && <p className="mt-2 font-mono text-xs text-amber-800">Reference: {digest}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => retry()} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
          Try again
        </button>
        <Link href="/dashboard" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Go to the Dashboard
        </Link>
      </div>
    </div>
  );
}
