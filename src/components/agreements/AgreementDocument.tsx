import { formatBusinessDateTime } from "@/lib/businessTime";
import { BrandMark, type BrandProps } from "@/components/brand/BrandMark";

// The agreement as it was sent (frozen text), plus the signature record
// once signed. Shared by the customer's signing page and the staff copy.
export function AgreementDocument({
  brand,
  title,
  body,
  signature,
}: {
  brand: BrandProps;
  title: string;
  body: string;
  signature?: { signedName: string; signedAt: Date; textHash: string; ip?: string | null; userAgent?: string | null } | null;
}) {
  return (
    <article className="rounded-lg border border-border bg-surface p-6 sm:p-8">
      <BrandMark brand={brand} height={32} tile nameClassName="text-sm font-semibold text-foreground" />
      <h1 className="mt-4 text-2xl font-semibold text-foreground">{title}</h1>
      <div className="mt-6 whitespace-pre-wrap text-sm leading-6 text-neutral-800">{body}</div>
      {signature && (
        <section aria-label="Signature" className="mt-8 border-t border-border pt-4 text-sm">
          <p className="font-serif text-2xl italic text-foreground">{signature.signedName}</p>
          <p className="mt-1 text-neutral-700">
            Signed electronically by <strong>{signature.signedName}</strong> on {formatBusinessDateTime(signature.signedAt)}.
          </p>
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            {signature.ip !== undefined && (
              <div>
                <dt className="inline">IP address: </dt>
                <dd className="inline">{signature.ip || "not recorded"}</dd>
              </div>
            )}
            {signature.userAgent !== undefined && (
              <div>
                <dt className="inline">Browser: </dt>
                <dd className="inline break-all">{signature.userAgent || "not recorded"}</dd>
              </div>
            )}
            <div>
              <dt className="inline">Document fingerprint (SHA-256): </dt>
              <dd className="inline break-all font-mono">{signature.textHash}</dd>
            </div>
          </dl>
        </section>
      )}
    </article>
  );
}
