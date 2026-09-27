"use client";

import { useState, useTransition } from "react";
import { setEmailPreference } from "./actions";

export function PreferenceToggles({
  token,
  highlight,
  marketing: initialMarketing,
  relationship: initialRelationship,
}: {
  token: string;
  highlight: "marketing" | "relationship";
  marketing: boolean;
  relationship: boolean;
}) {
  const [marketing, setMarketing] = useState(initialMarketing);
  const [relationship, setRelationship] = useState(initialRelationship);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (scope: "marketing" | "relationship", value: boolean) =>
    startTransition(async () => {
      const result = await setEmailPreference(token, scope, value);
      if (!result.ok) return setStatus("That link is no longer valid.");
      if (scope === "marketing") setMarketing(value);
      else setRelationship(value);
      setStatus(value ? "You're subscribed." : "You've been unsubscribed.");
    });

  const row = (scope: "marketing" | "relationship", label: string, detail: string, value: boolean) => (
    <li className={`rounded-lg border p-4 ${highlight === scope ? "border-slate-400" : "border-slate-200"}`}>
      <p className="font-medium text-slate-900">{label}</p>
      <p className="text-sm text-slate-600">{detail}</p>
      <p className="mt-2 text-sm text-slate-700">Currently: {value ? "subscribed" : "unsubscribed"}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => change(scope, !value)}
        className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {value ? "Unsubscribe" : "Subscribe"}
      </button>
    </li>
  );

  return (
    <div className="mt-6">
      <ul className="space-y-3">
        {row("marketing", "News and announcements", "New services, seasonal tips, and company updates.", marketing)}
        {row("relationship", "Personal notes", "Thank-yous, birthday and anniversary notes, and check-ins.", relationship)}
      </ul>
      {status && (
        <p role="status" className="mt-4 text-sm text-emerald-700">
          {status}
        </p>
      )}
    </div>
  );
}
