import { Ban, Cake, CalendarClock, CheckSquare, ClipboardCheck, FileText, Flag, Handshake, Receipt, Timer, UserRound, type LucideIcon } from "lucide-react";
import type { CalendarEvent, CalendarEventType } from "@/lib/calendar/types";

// Restrained on purpose: inspections get the one accent color; everything
// else is neutral and told apart by an icon plus a text label, never by
// color alone. Warnings are amber and always spelled out.
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
    if (e.status === "COMPLETED") return "border-slate-300 bg-slate-50 text-slate-600";
    return "border-emerald-600 bg-emerald-50 text-slate-900";
  }
  if (e.type === "block") return "border-slate-400 bg-[repeating-linear-gradient(135deg,var(--color-slate-100)_0_6px,var(--color-white)_6px_12px)] text-slate-700";
  if (e.priority === "high") return "border-amber-500 bg-amber-50 text-slate-900";
  return "border-slate-300 bg-white text-slate-800";
}

export function EventIcon({ event, className = "h-3.5 w-3.5" }: { event: CalendarEvent; className?: string }) {
  const Icon = EVENT_KIND[event.type].icon;
  return <Icon className={`${className} shrink-0`} aria-hidden="true" />;
}
