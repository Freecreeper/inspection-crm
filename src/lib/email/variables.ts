// The complete list of values a template may reference. Anything not
// listed here is never resolved — templates are text with placeholders,
// not code.

export interface VariableDefinition {
  key: string;
  label: string;
  sample: string;
  // Resolved only at the moment of sending and never stored in the saved
  // copy of the email (e.g. the secure report link, whose raw token must
  // not be persisted anywhere).
  sendTime?: boolean;
}

export const TEMPLATE_VARIABLES: VariableDefinition[] = [
  { key: "recipient.firstName", label: "Recipient first name", sample: "John" },
  { key: "recipient.fullName", label: "Recipient full name", sample: "John Smith" },

  { key: "customer.firstName", label: "Customer first name", sample: "John" },
  { key: "customer.lastName", label: "Customer last name", sample: "Smith" },
  { key: "customer.fullName", label: "Customer full name", sample: "John Smith" },

  { key: "realtor.firstName", label: "Realtor first (or preferred) name", sample: "Sally" },
  { key: "realtor.lastName", label: "Realtor last name", sample: "Jones" },
  { key: "realtor.fullName", label: "Realtor full name", sample: "Sally Jones" },
  { key: "brokerage.name", label: "Realtor's current brokerage", sample: "Keller Williams" },
  { key: "realtor.yearsInCareer", label: "Years since career start", sample: "10" },
  { key: "realtor.yearsWorkingTogether", label: "Years working together", sample: "5" },

  { key: "property.address", label: "Property address", sample: "123 Main Street, Hickory, NC 28601" },
  { key: "property.street", label: "Property street", sample: "123 Main Street" },
  { key: "property.city", label: "Property city", sample: "Hickory" },

  { key: "inspection.date", label: "Inspection date", sample: "Thursday, October 3, 2026" },
  { key: "inspection.time", label: "Inspection time", sample: "9:00 AM" },
  { key: "inspection.type", label: "Inspection services", sample: "General Home Inspection" },
  { key: "inspection.previousDate", label: "Previous inspection date (reschedules)", sample: "Wednesday, October 2, 2026" },
  { key: "inspection.previousTime", label: "Previous inspection time (reschedules)", sample: "1:00 PM" },
  { key: "inspector.name", label: "Inspector name", sample: "Jordan Inspector" },

  { key: "transaction.number", label: "Transaction reference", sample: "T-4F2A9C" },

  { key: "invoice.number", label: "Invoice number", sample: "INV-1042" },
  { key: "invoice.total", label: "Invoice total", sample: "$450.00" },
  { key: "invoice.balanceDue", label: "Balance due", sample: "$450.00" },
  { key: "invoice.dueDate", label: "Invoice due date", sample: "October 10, 2026" },

  { key: "report.number", label: "Report number", sample: "RPT-2026-0142" },
  { key: "report.version", label: "Report version number", sample: "1" },
  { key: "report.secureLink", label: "Secure report link (created at send time)", sample: "https://example.com/r/•••", sendTime: true },

  { key: "company.name", label: "Company name", sample: "Our inspection company" },
  { key: "company.phone", label: "Company phone", sample: "(828) 555-0100" },
  { key: "company.website", label: "Company website", sample: "https://example.com" },
  { key: "company.signature", label: "Email signature", sample: "The Inspection Team" },
  { key: "company.prepInstructions", label: "Inspection preparation instructions", sample: "Please make sure utilities are on." },
];

export const VARIABLE_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
export const SEND_TIME_KEYS = new Set(TEMPLATE_VARIABLES.filter((v) => v.sendTime).map((v) => v.key));

export type EmailVariables = Partial<Record<string, string | null>>;
