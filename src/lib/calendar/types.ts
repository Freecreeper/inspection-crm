// Pure (client-safe). A CalendarEvent is derived on every request from the
// authoritative record it describes — never stored — so the Calendar can't
// drift from Inspections, Tasks, Invoices, or Realtors.

import type { CalendarLayer } from "./layers";
import type { DayKey } from "./time";

export type CalendarEventType =
  | "inspection"
  | "appointment"
  | "block"
  | "task"
  | "realtorFollowUp"
  | "reportDue"
  | "closing"
  | "inspectionDeadline"
  | "birthday"
  | "careerAnniversary"
  | "relationshipAnniversary"
  | "invoiceDue";

export type SourceEntityType = "Inspection" | "Appointment" | "Task" | "InspectionReport" | "Transaction" | "Realtor" | "Invoice";

export interface CalendarWarning {
  code: "noInspector" | "conflict" | "agreementUnsigned" | "noCustomerContact" | "noServices" | "paymentDue";
  label: string;
}

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  layer: CalendarLayer;
  sourceType: SourceEntityType;
  sourceId: string;
  title: string;
  // One short secondary line (services, customer, brokerage…).
  subtitle: string | null;
  // Timed events: ISO instants. All-day events: `day` only.
  start: string | null;
  end: string | null;
  allDay: boolean;
  day: DayKey;
  inspectorId: string | null;
  inspectorName: string | null;
  status: string | null;
  priority: "normal" | "high";
  warnings: CalendarWarning[];
  href: string;
  // Words searched by the Calendar search box (address, customer, realtor…).
  searchText: string;
  // Inspections only: can this user drag/reschedule it?
  movable: boolean;
}
