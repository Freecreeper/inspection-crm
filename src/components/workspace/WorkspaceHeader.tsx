import Link from "next/link";

export interface WorkspaceMode {
  key: string;
  label: string;
  href: string;
}

// The two (or three) ways to work with one set of records: a record view
// for finding and managing them, and a workflow view for acting on them.
// Switching is a different query over the same records, never a different
// dataset, so the modes are plain links.
export function ModeSwitch({ label, modes, current }: { label: string; modes: WorkspaceMode[]; current: string }) {
  return (
    <nav aria-label={label} className="flex rounded-lg bg-neutral-100 p-0.5">
      {modes.map((m) => (
        <Link
          key={m.key}
          href={m.href}
          aria-current={m.key === current ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${m.key === current ? "bg-surface text-foreground shadow-sm" : "text-neutral-600 hover:text-foreground"}`}
        >
          {m.label}
        </Link>
      ))}
    </nav>
  );
}

// Title, mode switch and the page's primary action, the same on every
// module so moving between them feels like one app.
export function WorkspaceHeader({
  title,
  modes,
  current,
  modesLabel,
  actions,
}: {
  title: string;
  modes?: WorkspaceMode[];
  current?: string;
  modesLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {modes && current && <ModeSwitch label={modesLabel ?? `${title} views`} modes={modes} current={current} />}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// One queue in a workflow view: a heading with its count, an optional hint
// saying what belongs in it, and its rows (or a quiet empty line).
export function QueueSection({
  id,
  title,
  hint,
  count,
  empty,
  tone = "neutral",
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  count: number;
  empty: string;
  tone?: "neutral" | "warning" | "danger" | "accent";
  children: React.ReactNode;
}) {
  const badge = {
    neutral: "bg-neutral-100 text-neutral-600",
    warning: "bg-warning-soft text-warning-strong",
    danger: "bg-danger-soft text-danger-strong",
    accent: "bg-accent-100 text-accent-800",
  }[tone];
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-neutral-100 px-4 py-2.5">
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold text-foreground">
            {title} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${badge}`}>{count}</span>
          </h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </header>
      {count === 0 ? <p className="px-4 py-3 text-sm text-subtle">{empty}</p> : <ul className="divide-y divide-neutral-100">{children}</ul>}
    </section>
  );
}

// A row in a queue: what it is on the left, only the actions that fit it
// on the right.
export function QueueRow({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </li>
  );
}

// Small, consistent buttons for queue-row actions.
export const rowAction =
  "inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
