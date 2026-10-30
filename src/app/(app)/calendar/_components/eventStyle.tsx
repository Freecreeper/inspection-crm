import { Ban, Cake, CalendarClock, CheckSquare, ClipboardCheck, FileText, Flag, Handshake, Receipt, Timer, UserRound, type LucideIcon } from "lucide-react";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";

// Restrained on purpose: inspections get the accent color and tasks (and
// realtor follow-ups) their own violet, so both stand out; everything else
// is neutral and told apart by an icon plus a text label, never by color
// alone. Something due today or overdue gets an amber edge.
export const EVENT_KIND: Record<CalendarEventType, { label: string; icon: LucideIcon }> = {
  inspection: { label: "Inspection", icon: ClipboardCheck },
  appointment: { label: "Appointment", icon: CalendarClock },
  block: { label: "Blocked", icon: Ban },
  task: { label: "Task", icon: CheckSquare },
  realtorFollowUp: { label: "Realtor follow-up", icon: UserRound },
  reportDue: { label: "Report due", icon: FileText },
  closing: { label: "Closing", icon: Flag },
  inspectionDeadline: { label: "Inspection deadline", icon: Timer },
  birthday: { label: "Birthday", icon: Cake },
  careerAnniversary: { label: "Career anniversary", icon: Handshake },
  relationshipAnniversary: { label: "Working-together anniversary", icon: Handshake },
  invoiceDue: { label: "Invoice due", icon: Receipt },
};

export function eventTone(e: CalendarEvent): string {
  if (e.type === "inspection") {
    if (e.status === "COMPLETED") return "border-input bg-surface-secondary text-neutral-600";
    return "border-ring bg-selected text-foreground";
  }
  if (e.type === "block") return "border-neutral-400 bg-[repeating-linear-gradient(135deg,var(--color-neutral-100)_0_6px,var(--color-surface)_6px_12px)] text-neutral-700";
  if (e.type === "task" || e.type === "realtorFollowUp") return `${e.priority === "high" ? "border-amber-500" : "border-violet-500"} bg-violet-50 text-foreground`;
  if (e.priority === "high") return "border-amber-500 bg-warning-soft text-foreground";
  return "border-input bg-surface text-neutral-800";
}

export function EventIcon({ event, className = "h-3.5 w-3.5" }: { event: CalendarEvent; className?: string }) {
  const Icon = EVENT_KIND[event.type].icon;
  return <Icon className={`${className} shrink-0`} aria-hidden="true" />;
}
