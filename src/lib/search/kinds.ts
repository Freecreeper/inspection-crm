// Pure (client-safe): the record kinds global search covers, and the
// permission each needs.

import type { Permission } from "@/lib/rbac";

export const SEARCH_KINDS = ["customer", "realtor", "brokerage", "property", "transaction", "inspection"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  customer: "Customers",
  realtor: "Realtors",
  brokerage: "Brokerages",
  property: "Properties",
  transaction: "Transactions",
  inspection: "Inspections",
};

export const SEARCH_KIND_PERMISSIONS: Record<SearchKind, Permission[]> = {
  customer: ["search:global"],
  realtor: ["search:global"],
  brokerage: ["search:global"],
  property: ["search:global"],
  transaction: ["search:global"],
  inspection: ["search:global"],
};

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

export interface GlobalSearchResult {
  kind: SearchKind;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}
