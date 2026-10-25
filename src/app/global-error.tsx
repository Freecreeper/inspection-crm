"use client";

// Last resort when the root layout itself fails: it must render its own
// <html> and <body>.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", margin: 0 }}>
        <main role="alert" style={{ maxWidth: 480, margin: "15vh auto", padding: 24, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>The CRM couldn&apos;t load</h1>
          <p style={{ color: "#475569", fontSize: 14 }}>Please try again. If it keeps happening, share the reference below.</p>
          {digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>Reference: {digest}</p>}
          <button type="button" onClick={() => retry()} style={{ padding: "6px 12px", borderRadius: 6, background: "#0f172a", color: "#fff", border: 0 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
