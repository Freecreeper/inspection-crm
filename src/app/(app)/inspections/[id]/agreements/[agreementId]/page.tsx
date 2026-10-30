import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getEmailSettings } from "@/lib/email/settings";
import { AgreementDocument } from "@/components/agreements/AgreementDocument";

// The staff copy of an agreement request: the exact text that was sent and,
// once signed, the full signing record. Print it from the browser to keep
// a PDF.
export default async function AgreementCopyPage({ params }: { params: Promise<{ id: string; agreementId: string }> }) {
  const { id, agreementId } = await params;
  const [agreement, settings] = await Promise.all([prisma.inspectionAgreement.findFirst({ where: { id: agreementId, inspectionId: id } }), getEmailSettings()]);
  if (!agreement) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/inspections/${id}`} className="text-sm text-info-strong hover:underline">
        ← Inspection
      </Link>
      <p className="text-sm text-muted-foreground">
        {agreement.status === "SIGNED" ? "Signed copy" : agreement.status === "REVOKED" ? "Cancelled request — not signed" : "Waiting for signature"} · sent to {agreement.signerName}
        {agreement.signerEmail ? ` (${agreement.signerEmail})` : ""}. Use your browser&apos;s Print to save a PDF.
      </p>
      <AgreementDocument
        companyName={settings.companyName}
        title={agreement.title}
        body={agreement.body}
        signature={
          agreement.status === "SIGNED" && agreement.signedAt && agreement.signedName
            ? { signedName: agreement.signedName, signedAt: agreement.signedAt, textHash: agreement.textHash, ip: agreement.signedIp, userAgent: agreement.signedUserAgent }
            : null
        }
      />
    </div>
  );
}
