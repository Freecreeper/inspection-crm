"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { ROLE_LABELS, ROLES } from "@/lib/userRoles";
import { changeRoleAction, createUserAction, resetPasswordAction, setActiveAction } from "./actions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

const input = "mt-1 block w-full rounded-md border border-input px-2.5 py-1.5 text-sm";
const button = "rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover disabled:opacity-50";

// A temporary password is shown exactly once, here, and never stored in
// readable form. The person must choose their own at first sign-in.
function OneTimePassword({ email, password, onDone }: { email: string; password: string; onDone: () => void }) {
  return (
    <div role="status" className="rounded-md border border-success-border bg-success-soft p-3 text-sm text-success-strong">
      <p>
        Temporary password for <strong>{email}</strong> — share it privately. It&apos;s shown only once; they&apos;ll choose their own when they sign in.
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-surface px-2 py-1 font-mono text-base tracking-wide text-foreground">{password}</code>
        <button type="button" className={button} onClick={() => navigator.clipboard?.writeText(password)}>
          Copy
        </button>
        <button type="button" className={button} onClick={onDone}>
          Done
        </button>
      </p>
    </div>
  );
}

export function UsersManager({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "OFFICE_STAFF" });

  const run = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, then?: (data: T) => void) =>
    start(async () => {
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) return setError(r.error);
        then?.(r.data);
        router.refresh();
      } catch {
        setError("You don't have permission to do that.");
      }
    });

  return (
    <div className="mt-6 space-y-6">
      {secret && <OneTimePassword email={secret.email} password={secret.password} onDone={() => setSecret(null)} />}
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {error}
        </p>
      )}

      <section aria-labelledby="add-user" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="add-user" className="text-sm font-semibold text-foreground">
          Add a user
        </h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createUserAction(form),
              (d) => {
                setSecret({ email: d.email, password: d.temporaryPassword });
                setForm({ name: "", email: "", role: "OFFICE_STAFF" });
              }
            );
          }}
        >
          <label className="block text-sm font-medium text-neutral-700">
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </label>
          <label className="block text-sm font-medium text-neutral-700">
            Email
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
          </label>
          <label className="block text-sm font-medium text-neutral-700">
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
            Add user
          </button>
        </form>
      </section>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === currentUserId;
              return (
                <tr key={u.id} className={`border-t border-neutral-100 ${u.active ? "" : "text-subtle"}`}>
                  <td className="px-4 py-2">
                    <p className={`font-medium ${u.active ? "text-foreground" : ""}`}>
                      {u.name}
                      {self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-4 py-2">
                    <label className="sr-only" htmlFor={`role-${u.id}`}>
                      Role for {u.name}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      value={u.role}
                      disabled={pending || self}
                      onChange={(e) => run(() => changeRoleAction(u.id, e.target.value))}
                      className="rounded-md border border-input bg-surface px-2 py-1 text-sm disabled:opacity-60"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {u.active ? (u.mustChangePassword ? "Active · temporary password" : "Active") : "Deactivated"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {u.active && (
                        <button type="button" className={button} disabled={pending} onClick={() => run(() => resetPasswordAction(u.id), (d) => setSecret({ email: u.email, password: d.temporaryPassword }))}>
                          Reset password
                        </button>
                      )}
                      {!self && (
                        <button
                          type="button"
                          className={button}
                          disabled={pending}
                          onClick={() => {
                            if (u.active && !window.confirm(`Deactivate ${u.name}? They'll be signed out everywhere right away.`)) return;
                            run(() => setActiveAction(u.id, !u.active));
                          }}
                        >
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
