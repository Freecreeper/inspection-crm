import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatBusinessDateTime } from "@/lib/businessTime";
import { getAgreementWording, MAX_AGREEMENT_LENGTH } from "@/lib/agreements/service";
import { AGREEMENT_VARIABLES, DEFAULT_AGREEMENT_BODY } from "@/lib/agreements/text";
import { TEMPLATE_VARIABLES } from "@/lib/email/variables";
import { AgreementEditor } from "./AgreementEditor";

export default async function AgreementSettingsPage() {
  const session = await auth();
  if (!can(session?.user?.role as Role | undefined, "agreement:manage")) {
    return <p className="text-sm text-neutral-600">Only an owner can change the inspection agreement.</p>;
  }
  const wording = await getAgreementWording();
  const variables = AGREEMENT_VARIABLES.map((key) => ({ key, label: TEMPLATE_VARIABLES.find((v) => v.key === key)?.label ?? key }));
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Inspection agreement</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The agreement customers read and sign online. When staff request a signature, the placeholders below are filled in for that inspection and the text is frozen, so changing it here never alters an agreement already sent or signed.
      </p>
      {wording.isDefault ? (
        <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          This is placeholder wording, not legal advice. Replace it with your own agreement, reviewed by an attorney licensed in your state, before sending it to customers.
        </p>
      ) : (
        wording.updatedAt && <p className="mt-4 text-xs text-muted-foreground">Last changed {formatBusinessDateTime(wording.updatedAt)}.</p>
      )}
      <AgreementEditor title={wording.title} body={wording.body} isDefault={wording.isDefault} defaultBody={DEFAULT_AGREEMENT_BODY} maxLength={MAX_AGREEMENT_LENGTH} variables={variables} />
    </div>
  );
}
