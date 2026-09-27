import type { EmailCategory, EmailRecipientType, Prisma, PrismaClient } from "@prisma/client";

// Starting copy, created only when missing and never overwritten — once a
// template exists, it belongs to the business. No path-alias imports here:
// prisma/seed.ts imports this file directly.

interface DefaultTemplate {
  key: string;
  name: string;
  description: string;
  category: EmailCategory;
  recipientType: EmailRecipientType;
  automationEligible: boolean;
  subject: string;
  body: string;
}

const SIGN_OFF = `{{company.signature | "Thank you,"}}
{{company.name}}
{{company.phone | ""}}`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "inspection_confirmation",
    name: "Inspection confirmation",
    description: "Confirms a newly scheduled inspection to the customer.",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    automationEligible: true,
    subject: "Your home inspection is scheduled for {{inspection.date}}",
    body: `Hi {{customer.firstName}},

Your home inspection is confirmed.

Property: {{property.address}}
Date: {{inspection.date}}
Time: {{inspection.time}}
Services: {{inspection.type | "Home inspection"}}
Inspector: {{inspector.name | "We'll confirm your inspector shortly"}}

{{company.prepInstructions | ""}}

If you need to change anything, just reply to this email.

${SIGN_OFF}`,
  },
  {
    key: "inspection_confirmation_realtor",
    name: "Inspection confirmation (realtor)",
    description: "Optional copy for the transaction's realtor, when enabled.",
    category: "TRANSACTIONAL",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Inspection scheduled: {{property.street}} on {{inspection.date}}",
    body: `Hi {{realtor.firstName}},

The inspection for {{property.address}} is scheduled for {{inspection.date}} at {{inspection.time}}.

${SIGN_OFF}`,
  },
  {
    key: "inspection_reminder",
    name: "Inspection reminder",
    description: "Reminder sent before the inspection.",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    automationEligible: true,
    subject: "Reminder: your inspection is {{inspection.date}} at {{inspection.time}}",
    body: `Hi {{customer.firstName}},

This is a reminder that your home inspection at {{property.address}} is on {{inspection.date}} at {{inspection.time}}.

{{company.prepInstructions | ""}}

${SIGN_OFF}`,
  },
  {
    key: "inspection_reminder_realtor",
    name: "Inspection reminder (realtor)",
    description: "Optional reminder for the transaction's realtor, when enabled.",
    category: "TRANSACTIONAL",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Reminder: inspection at {{property.street}} {{inspection.date}}",
    body: `Hi {{realtor.firstName}},

A reminder that the inspection at {{property.address}} is on {{inspection.date}} at {{inspection.time}}.

${SIGN_OFF}`,
  },
  {
    key: "appointment_updated",
    name: "Appointment updated",
    description: "Sent when the inspection's date or time changes.",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    automationEligible: true,
    subject: "Your inspection has moved to {{inspection.date}} at {{inspection.time}}",
    body: `Hi {{customer.firstName}},

Your home inspection at {{property.address}} has been rescheduled.

New date: {{inspection.date}}
New time: {{inspection.time}}
(Previously {{inspection.previousDate | "a different time"}} {{inspection.previousTime | ""}})

${SIGN_OFF}`,
  },
  {
    key: "appointment_updated_realtor",
    name: "Appointment updated (realtor)",
    description: "Optional realtor copy of a reschedule notice.",
    category: "TRANSACTIONAL",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Rescheduled: inspection at {{property.street}}",
    body: `Hi {{realtor.firstName}},

The inspection at {{property.address}} is now {{inspection.date}} at {{inspection.time}}.

${SIGN_OFF}`,
  },
  {
    key: "appointment_cancelled",
    name: "Appointment cancelled",
    description: "Sent when an inspection is cancelled.",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    automationEligible: true,
    subject: "Your inspection at {{property.street}} has been cancelled",
    body: `Hi {{customer.firstName}},

Your home inspection at {{property.address}} has been cancelled. If this is unexpected or you'd like to reschedule, just reply to this email.

${SIGN_OFF}`,
  },
  {
    key: "appointment_cancelled_realtor",
    name: "Appointment cancelled (realtor)",
    description: "Optional realtor copy of a cancellation notice.",
    category: "TRANSACTIONAL",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Cancelled: inspection at {{property.street}}",
    body: `Hi {{realtor.firstName}},

The inspection at {{property.address}} has been cancelled.

${SIGN_OFF}`,
  },
  {
    key: "payment_reminder",
    name: "Payment reminder",
    description: "Reminds the customer of a balance due on an issued invoice.",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    automationEligible: true,
    subject: 'Invoice {{invoice.number}}: {{invoice.balanceDue}} due {{invoice.dueDate | "upon receipt"}}',
    body: `Hi {{customer.firstName}},

This is a reminder that invoice {{invoice.number}} for your inspection at {{property.address | "your property"}} has a balance of {{invoice.balanceDue}}.

Invoice total: {{invoice.total}}
Due: {{invoice.dueDate | "upon receipt"}}

If you've already paid, thank you — please disregard this message.

${SIGN_OFF}`,
  },
  {
    key: "report_ready",
    name: "Report ready",
    description: "Secure link to a finalized inspection report version.",
    category: "TRANSACTIONAL",
    recipientType: "OTHER",
    automationEligible: true,
    subject: "Your inspection report is ready",
    body: `Hi {{recipient.firstName}},

The inspection report for {{property.address | "your property"}} is ready.

View it securely here:
{{report.secureLink}}

This link is private to you and expires in 30 days.

${SIGN_OFF}`,
  },
  {
    key: "realtor_thank_you",
    name: "Realtor thank-you",
    description: "Thanks a realtor after an inspection on their transaction.",
    category: "RELATIONSHIP",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Thank you for the {{property.street}} inspection",
    body: `Hi {{realtor.firstName}},

Thank you for working with us on {{property.address}}. We appreciate the opportunity and look forward to the next one.

${SIGN_OFF}`,
  },
  {
    key: "realtor_birthday",
    name: "Realtor birthday",
    description: "A short birthday note.",
    category: "RELATIONSHIP",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Happy birthday, {{realtor.firstName}}!",
    body: `Hi {{realtor.firstName}},

Wishing you a very happy birthday from all of us at {{company.name}}.

${SIGN_OFF}`,
  },
  {
    key: "realtor_career_anniversary",
    name: "Realtor career anniversary",
    description: "Congratulates a realtor on a real estate career anniversary.",
    category: "RELATIONSHIP",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Congratulations on {{realtor.yearsInCareer}} years in real estate",
    body: `Hi {{realtor.firstName}},

Congratulations on {{realtor.yearsInCareer}} years in real estate! That's quite a milestone.

${SIGN_OFF}`,
  },
  {
    key: "realtor_relationship_anniversary",
    name: "Working-together anniversary",
    description: "Thanks a realtor on the anniversary of working together.",
    category: "RELATIONSHIP",
    recipientType: "REALTOR",
    automationEligible: true,
    subject: "Thank you for {{realtor.yearsWorkingTogether}} years of working together",
    body: `Hi {{realtor.firstName}},

It's been {{realtor.yearsWorkingTogether}} years since we started working together. Thank you for your trust and your referrals.

${SIGN_OFF}`,
  },
  {
    key: "realtor_follow_up",
    name: "Realtor follow-up",
    description: "A general relationship follow-up, prepared from a follow-up task.",
    category: "RELATIONSHIP",
    recipientType: "REALTOR",
    automationEligible: false,
    subject: "Checking in",
    body: `Hi {{realtor.firstName}},

I wanted to check in and see how things are going. Is there anything coming up we can help with?

${SIGN_OFF}`,
  },
  {
    key: "new_service_announcement",
    name: "New service announcement",
    description: "Announces a new inspection service to realtors (marketing).",
    category: "MARKETING",
    recipientType: "REALTOR",
    automationEligible: false,
    subject: "Now offering a new inspection service",
    body: `Hi {{realtor.firstName}},

We're excited to share that we now offer a new inspection service for your clients.

[Describe the service here.]

${SIGN_OFF}`,
  },
  {
    key: "realtor_educational",
    name: "Seasonal / educational update",
    description: "Educational or seasonal content for realtors (marketing).",
    category: "MARKETING",
    recipientType: "REALTOR",
    automationEligible: false,
    subject: "A quick inspection tip for this season",
    body: `Hi {{realtor.firstName}},

[Your seasonal or educational content here.]

${SIGN_OFF}`,
  },
  {
    key: "customer_message",
    name: "General message to customer",
    description: "A blank starting point for a one-off operational email.",
    category: "TRANSACTIONAL",
    recipientType: "CUSTOMER",
    automationEligible: false,
    subject: "",
    body: `Hi {{customer.firstName}},



${SIGN_OFF}`,
  },
];

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureDefaultTemplates(db: Db) {
  for (const t of DEFAULT_TEMPLATES) {
    await db.emailTemplate.upsert({
      where: { key: t.key },
      update: {},
      create: { ...t, isSystem: true },
    });
  }
  await db.emailSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}
