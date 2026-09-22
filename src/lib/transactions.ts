import type { Customer, TransactionCustomer } from "@prisma/client";

type WithCustomer = TransactionCustomer & { customer: Customer };

// Transaction has no primaryCustomerId scalar (PR #1 review item 1) — the
// primary contact is whichever TransactionCustomer row has primaryContact
// true. Falls back to the first customer on the transaction (by creation
// order) so a transaction that hasn't had a primary contact explicitly set
// yet still has something reasonable to display.
export function getPrimaryCustomer(customers: WithCustomer[]): Customer | null {
  const primary = customers.find((tc) => tc.primaryContact);
  if (primary) return primary.customer;
  return customers[0]?.customer ?? null;
}
