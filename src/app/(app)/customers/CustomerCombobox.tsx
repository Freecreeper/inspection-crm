"use client";

import { Combobox, type ComboboxOption } from "@/components/Combobox";

// No "create new" here on purpose — this app only ever creates a Customer
// by converting a Lead (see src/app/(app)/customers/page.tsx: "No
// customers yet — convert a lead to create one"). Adding an inline
// quick-create would open a second, unreviewed path to the same record
// type, so this stays search-only.
export function CustomerCombobox({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: ComboboxOption[];
  defaultValue?: string;
}) {
  return <Combobox name={name} options={options} defaultValue={defaultValue} placeholder="Search customers…" />;
}
