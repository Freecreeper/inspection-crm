"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { getSchedulingOptions, type SchedulingOptions } from "../calendar/actions";
import { AddTaskDialog } from "../calendar/_components/ChangeDialogs";
import { ScheduleDialog } from "../calendar/_components/ScheduleDialog";
import { AddBrokerageModal } from "../brokerages/_components/AddBrokerageModal";
import { GlobalSearch } from "./GlobalSearch";
import { NewCustomerDialog, NewMenu, type NewAction } from "./NewMenu";

export interface ShellViewer {
  userId: string;
  role: string;
  canSearch: boolean;
  canSchedule: boolean;
  canWriteCrm: boolean;
  canAddTask: boolean;
}

// The top bar's right side on every page: global search and "+ New".
// Scheduling options (services, inspectors) load only when a dialog that
// needs them opens, so pages pay nothing for the menu.
export function ShellActions({ viewer, today, timeZone, defaultDurationMinutes }: { viewer: ShellViewer; today: string; timeZone: string; defaultDurationMinutes: number }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<NewAction | null>(null);
  const [options, setOptions] = useState<SchedulingOptions | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function open(action: NewAction) {
    if ((action === "schedule" || action === "task") && !options) {
      try {
        setOptions(await getSchedulingOptions());
      } catch {
        setNotice("Couldn't load scheduling options. Try again.");
        return;
      }
    }
    setDialog(action);
  }

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    // Whatever page is open shows the new record on its next render.
    router.refresh();
  }

  return (
    <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
      {viewer.canSearch && <GlobalSearch />}
      <NewMenu canSchedule={viewer.canSchedule} canWriteCrm={viewer.canWriteCrm} canAddTask={viewer.canAddTask} onAction={open} />

      {dialog === "schedule" && options && (
        <ScheduleDialog
          initialDay={today}
          initialTime="09:00"
          options={options}
          timeZone={timeZone}
          defaultDurationMinutes={defaultDurationMinutes}
          defaultInspectorId={viewer.role === "INSPECTOR" ? viewer.userId : null}
          onClose={() => setDialog(null)}
          onScheduled={() => done("Inspection scheduled. The confirmation email follows your automation settings.")}
        />
      )}
      {dialog === "task" && options && <AddTaskDialog initialDay={today} people={options.inspectors} onClose={() => setDialog(null)} onDone={() => done("Task added.")} />}
      {dialog === "customer" && <NewCustomerDialog onClose={() => setDialog(null)} />}
      {dialog === "brokerage" && <AddBrokerageModal onClose={() => setDialog(null)} />}

      {notice && (
        <p role="status" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-800 shadow-lg">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 hover:bg-accent-100">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </p>
      )}
    </div>
  );
}
