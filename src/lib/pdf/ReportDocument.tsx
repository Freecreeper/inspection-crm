import { formatBusinessDate, formatBusinessDateTimeWithZone } from "@/lib/businessTime";
import { Document, Page, Text, View, Image, StyleSheet, Svg, Rect, Path, G } from "@react-pdf/renderer";
import type { ReportSnapshot } from "@/lib/reportEngine";
import { HOUSE_PATHS, textOnBrand } from "@/lib/brand/shared";

// Deliberately not a design system — this is a functional cover +
// section/finding/summary layout for Version 1 (§ "Professional PDF
// Generation"), branded from Settings → Branding: the logo (or the
// placeholder mark) and contact details on the cover, the company name at
// the top of every later page and in the footer.
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1e293b" },
  coverTitle: { fontSize: 22, marginBottom: 8, fontFamily: "Helvetica-Bold" },
  coverMeta: { fontSize: 11, marginBottom: 4, color: "#475569" },
  h1: { fontSize: 16, marginBottom: 8, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 13, marginTop: 14, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  h3: { fontSize: 11, marginTop: 8, marginBottom: 2, fontFamily: "Helvetica-Bold" },
  p: { fontSize: 10, marginBottom: 4, lineHeight: 1.4 },
  label: { fontSize: 9, color: "#64748b" },
  badge: { fontSize: 8, color: "#334155", backgroundColor: "#f1f5f9", padding: 3, marginRight: 4 },
  finding: { marginBottom: 8, paddingBottom: 8, borderBottom: "1 solid #e2e8f0" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  photo: { width: 140, height: 105, marginRight: 6, marginBottom: 6, objectFit: "cover" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 8, color: "#94a3b8", textAlign: "center" },
  pageNumber: { position: "absolute", bottom: 20, right: 36, fontSize: 8, color: "#94a3b8" },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 14, marginBottom: 18, borderBottomWidth: 2 },
  brandName: { fontSize: 14, fontFamily: "Helvetica-Bold", marginLeft: 8 },
  brandContact: { fontSize: 8.5, color: "#475569", textAlign: "right", lineHeight: 1.4 },
  runningHeader: { position: "absolute", top: 16, left: 36, right: 36, fontSize: 8, color: "#94a3b8" },
});

// What the PDF needs to brand a report; built in renderReportPdf.ts.
export interface PdfBrand {
  companyName: string;
  phone: string | null;
  website: string | null;
  mailingAddress: string | null;
  brandColor: string;
  logo: { dataUri: string; width: number; height: number } | null;
}

function BrandHeader({ brand }: { brand: PdfBrand }) {
  const contact = [brand.phone, brand.website?.replace(/^https?:\/\//, ""), brand.mailingAddress].filter(Boolean);
  const logoHeight = 40;
  return (
    <View style={[styles.brandRow, { borderBottomColor: brand.brandColor }]}>
      {brand.logo ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image (no alt attribute exists); the company name is printed beside it
        <Image src={brand.logo.dataUri} style={{ height: logoHeight, width: Math.min(220, (brand.logo.width / brand.logo.height) * logoHeight), objectFit: "contain" }} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Svg width={32} height={32} viewBox="0 0 32 32">
            <Rect width={32} height={32} rx={7} fill={brand.brandColor} />
            <G transform="translate(5.6 5.6) scale(0.867)">
              {HOUSE_PATHS.map((d) => (
                <Path key={d} d={d} fill="none" stroke={textOnBrand(brand.brandColor)} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </G>
          </Svg>
          <Text style={styles.brandName}>{brand.companyName}</Text>
        </View>
      )}
      <View>
        {brand.logo && <Text style={[styles.brandContact, { fontFamily: "Helvetica-Bold", color: "#1e293b" }]}>{brand.companyName}</Text>}
        {contact.map((line) => (
          <Text key={line} style={styles.brandContact}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

export interface FindingPhoto {
  findingKey: string; // matches "sectionIndex-componentIndex-findingIndex"
  dataUri: string;
  caption: string | null;
}

export function ReportDocument({ snapshot, photosByFinding, brand }: { snapshot: ReportSnapshot; photosByFinding: Map<string, FindingPhoto[]>; brand: PdfBrand }) {
  const inspectionDate = snapshot.inspectionDate ? formatBusinessDate(snapshot.inspectionDate) : "Not recorded";

  return (
    <Document title={`${snapshot.reportNumber} — Inspection Report`} author={brand.companyName}>
      <Page size="LETTER" style={styles.page}>
        <BrandHeader brand={brand} />
        <Text style={styles.coverTitle}>{snapshot.title || "Property Inspection Report"}</Text>
        <Text style={styles.coverMeta}>Report Number: {snapshot.reportNumber}</Text>
        <Text style={styles.coverMeta}>
          {snapshot.property.addressLine1}
          {snapshot.property.addressLine2 ? `, ${snapshot.property.addressLine2}` : ""}, {snapshot.property.city},{" "}
          {snapshot.property.state} {snapshot.property.zip}
        </Text>
        <Text style={styles.coverMeta}>Inspection Date: {inspectionDate}</Text>
        <Text style={styles.coverMeta}>Prepared For: {snapshot.customerName || "Not recorded"}</Text>
        <Text style={styles.coverMeta}>Inspector: {snapshot.inspectorName || "Not recorded"}</Text>
        <Text style={styles.coverMeta}>
          Version {snapshot.versionNumber} — Finalized {formatBusinessDateTimeWithZone(snapshot.finalizedAt)}
        </Text>
        {snapshot.reasonForRevision && (
          <Text style={styles.coverMeta}>Reason for revision: {snapshot.reasonForRevision}</Text>
        )}

        {snapshot.introduction && (
          <>
            <Text style={styles.h2}>Introduction</Text>
            <Text style={styles.p}>{snapshot.introduction}</Text>
          </>
        )}
        {snapshot.scope && (
          <>
            <Text style={styles.h2}>Scope</Text>
            <Text style={styles.p}>{snapshot.scope}</Text>
          </>
        )}
        {snapshot.limitations && (
          <>
            <Text style={styles.h2}>Limitations</Text>
            <Text style={styles.p}>{snapshot.limitations}</Text>
          </>
        )}

        <Text style={styles.footer}>{snapshot.footer || `Prepared by ${brand.companyName} — not an engineering, legal, or code-compliance determination.`}</Text>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {snapshot.summary.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.runningHeader} fixed>
            {brand.companyName} · {snapshot.reportNumber}
          </Text>
          <Text style={styles.h1}>Summary</Text>
          {Object.entries(groupBy(snapshot.summary, (s) => s.groupLabel)).map(([group, items]) => (
            <View key={group}>
              <Text style={styles.h2}>{group}</Text>
              {items.map((item, idx) => {
                const finding = findFindingById(snapshot, item.findingId);
                if (!finding) return null;
                return (
                  <Text key={idx} style={styles.p}>
                    • {finding.title}
                  </Text>
                );
              })}
            </View>
          ))}
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        </Page>
      )}

      {snapshot.sections.map((section, sIdx) => (
        <Page key={sIdx} size="LETTER" style={styles.page} wrap>
          <Text style={styles.runningHeader} fixed>
            {brand.companyName} · {snapshot.reportNumber}
          </Text>
          <Text style={styles.h1}>{section.name}</Text>
          {section.notApplicable ? (
            <Text style={styles.p}>Not applicable to this property.</Text>
          ) : (
            // Components may run across pages (a whole component held on
            // one page overprinted anything taller than the page). Headings
            // ask for room after them so they're never stranded at a page
            // bottom, and each photo stays with its caption.
            section.components.map((component, cIdx) => (
              <View key={cIdx}>
                <Text style={styles.h3} minPresenceAhead={40}>
                  {component.name} — <Text style={styles.label}>{component.inspectionStatus.replace(/_/g, " ")}</Text>
                </Text>
                {component.limitationNote && <Text style={styles.p}>Note: {component.limitationNote}</Text>}
                {component.notes && <Text style={styles.p}>{component.notes}</Text>}
                {component.findings.map((finding, fIdx) => {
                  const key = `${sIdx}-${cIdx}-${fIdx}`;
                  const photos = photosByFinding.get(key) ?? [];
                  return (
                    <View key={fIdx} style={styles.finding}>
                      <Text style={styles.h3} minPresenceAhead={40}>
                        {finding.title}
                      </Text>
                      <View style={{ flexDirection: "row", marginBottom: 2 }}>
                        {finding.category && <Text style={styles.badge}>{finding.category}</Text>}
                        {finding.safetyRelated && <Text style={styles.badge}>Safety</Text>}
                        {finding.repairRecommended && <Text style={styles.badge}>Repair Recommended</Text>}
                        {finding.monitor && <Text style={styles.badge}>Monitor</Text>}
                        {finding.furtherEvaluation && <Text style={styles.badge}>Further Evaluation</Text>}
                      </View>
                      {finding.location && <Text style={styles.label}>Location: {finding.location}</Text>}
                      <Text style={styles.p}>{finding.description}</Text>
                      {finding.recommendation && (
                        <Text style={styles.p}>Recommendation: {finding.recommendation}</Text>
                      )}
                      {photos.length > 0 && (
                        <View style={styles.photoRow}>
                          {photos.map((photo, pIdx) => (
                            <View key={pIdx} wrap={false}>
                              <Image src={photo.dataUri} style={styles.photo} />
                              {photo.caption && <Text style={styles.label}>{photo.caption}</Text>}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ))
          )}
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        </Page>
      ))}
    </Document>
  );
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

function findFindingById(snapshot: ReportSnapshot, findingId: string) {
  for (const section of snapshot.sections) {
    for (const component of section.components) {
      for (const finding of component.findings) {
        if (finding.id === findingId) return finding;
      }
    }
  }
  return null;
}
