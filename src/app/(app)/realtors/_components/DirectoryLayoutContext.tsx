"use client";

import { createContext, useCallback, useContext, useState, useTransition } from "react";
import { DEFAULT_DIRECTORY_LAYOUT, type DirectoryColumn, type DirectoryLayout } from "@/lib/realtors/directoryLayout";
import { saveRealtorDirectoryLayout } from "../actions";

interface LayoutContextValue {
  layout: DirectoryLayout;
  show: (column: DirectoryColumn) => boolean;
  update: (next: DirectoryLayout) => void;
  saving: boolean;
  error: string | null;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

// Shared by the toolbar (which edits the layout) and the table (which
// renders it). Changes apply at once and are saved to the user's account;
// a failed save rolls back.
export function DirectoryLayoutProvider({ initial, children }: { initial: DirectoryLayout; children: React.ReactNode }) {
  const [layout, setLayout] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const update = useCallback(
    (next: DirectoryLayout) => {
      const previous = layout;
      setLayout(next);
      setError(null);
      startTransition(async () => {
        try {
          const result = await saveRealtorDirectoryLayout(next);
          if (!result.ok) throw new Error(result.error);
        } catch {
          setLayout(previous);
          setError("Couldn't save your layout. Try again.");
        }
      });
    },
    [layout]
  );

  const show = useCallback((column: DirectoryColumn) => layout.columns.includes(column), [layout]);

  return <LayoutContext.Provider value={{ layout, show, update, saving, error }}>{children}</LayoutContext.Provider>;
}

// Outside a provider (e.g. a component test rendering the table alone)
// everything falls back to the default layout.
export function useDirectoryLayout(): LayoutContextValue {
  return (
    useContext(LayoutContext) ?? {
      layout: DEFAULT_DIRECTORY_LAYOUT,
      show: () => true,
      update: () => {},
      saving: false,
      error: null,
    }
  );
}
