import { describe, it, expect } from "vitest";
import { renderReportPdf } from "./renderReportPdf";
import type { ReportSnapshot } from "@/lib/reportEngine";

// Pages in a rendered PDF (each page object is "/Type /Page", not "/Pages").
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

function snapshot(findings: number): ReportSnapshot {
  const long = "Moisture staining observed at the ceiling below the bathroom, with soft drywall when probed. ".repeat(6);
  return {
    reportNumber: "RPT-TEST",
    title: "Home Inspection",
    introduction: null,
    scope: null,
    limitations: null,
    footer: null,
    customerFacingNotes: null,
    property: { addressLine1: "1 Test St", addressLine2: null, city: "Hickory", state: "NC", zip: "28601", yearBuilt: null, squareFootage: null },
    inspectorName: "Jordan",
    customerName: "Ava Chen",
    inspectionDate: "2026-10-20T13:00:00.000Z",
    finalizedAt: "2026-10-21T13:00:00.000Z",
    versionNumber: 1,
    reasonForRevision: null,
    sections: [
      {
        name: "Interior",
        notApplicable: false,
        components: [
          {
            name: "Ceilings",
            inspectionStatus: "INSPECTED",
            limitationNote: null,
            notes: null,
            findings: Array.from({ length: findings }, (_, i) => ({
              id: `f${i}`,
              title: `Finding ${i + 1}`,
              description: long,
              location: "Hall bath",
              category: "Repair",
              recommendation: "Have a licensed contractor evaluate and repair.",
              safetyRelated: false,
              repairRecommended: true,
              monitor: false,
              furtherEvaluation: false,
            })),
          },
        ],
      },
    ],
    summary: [],
  } as unknown as ReportSnapshot;
}

describe("report PDF page breaks", () => {
  it("a component taller than one page continues onto the next pages instead of overprinting", async () => {
    const short = pageCount(await renderReportPdf(snapshot(1), []));
    const tall = pageCount(await renderReportPdf(snapshot(25), []));
    // 25 long findings can't fit on one page: the section must span several.
    expect(tall - short).toBeGreaterThanOrEqual(3);
    if (process.env.PDF_SAMPLE_OUT) await (await import("node:fs/promises")).writeFile(process.env.PDF_SAMPLE_OUT, await renderReportPdf(snapshot(25), []));
  }, 30_000);
});
