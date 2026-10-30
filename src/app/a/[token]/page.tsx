import type { Metadata } from "next";
import { getEmailSettings } from "@/lib/email/settings";
import { formatBusinessDate } from "@/lib/businessTime";
import { loadForSigning } from "@/lib/agreements/service";
import { AgreementDocument } from "@/components/agreements/AgreementDocument";
import { SignForm } from "./SignForm";
import { getBrand } from "@/lib/brand/service";
import { PublicBrandHeader, toBrandProps } from "@/components/brand/PublicBrandHeader";

export const metadata: Metadata = { title: "Inspection agreement", robots: { index: false, follow: false } };

// Public, signed-token page (no staff session, outside the (app) layout).
// Viewing never changes anything; signing needs the box ticked, a typed
// name and a button press, so link scanners can't sign.
export default async function SignAgreementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [view, settings, brand] = await Promise.all([loadForSigning(token), getEmailSettings(), getBrand()]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <PublicBrandHeader />
      {view.state === "invalid" ? (
        <Notice title="This link isn't valid">Check that you opened the whole link from your email, or contact {settings.companyName} for a new one.</Notice>
      ) : (
        <div className="space-y-6">
          {view.state === "signed" && (
            <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-strong">
              Signed. Thank you, {view.signedName}. You can keep this page as your copy.
            </p>
          )}
          {view.state === "cancelled" && <Notice title="This link is no longer active">It was cancelled or replaced by a newer one. Contact {settings.companyName} for the current link.</Notice>}
          {view.state === "expired" && <Notice title="This link has expired">It expired on {formatBusinessDate(view.expiresAt)}. Contact {settings.companyName} for a new one.</Notice>}
          <AgreementDocument
            brand={toBrandProps(brand)}
            title={view.title}
            body={view.body}
            signature={view.state === "signed" && view.signedAt && view.signedName ? { signedName: view.signedName, signedAt: view.signedAt, textHash: view.textHash } : null}
          />
          {view.state === "open" && <SignForm token={token} expectedName={view.signerName} expiresOn={formatBusinessDate(view.expiresAt)} />}
        </div>
      )}
    </main>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-neutral-700">{children}</p>
    </div>
  );
}
