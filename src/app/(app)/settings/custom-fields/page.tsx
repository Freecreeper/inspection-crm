import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { listFieldDefinitions } from "@/lib/customFields/service";
import { CustomFieldsManager } from "./CustomFieldsManager";

export default async function CustomFieldsPage() {
  const session = await auth();
  if (!can(session?.user?.role as Role | undefined, "custom-field:manage")) {
    return <p className="text-sm text-neutral-600">Only an owner can manage custom fields.</p>;
  }
  const defs = await listFieldDefinitions();
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-foreground">Custom fields</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add your own fields to properties, customers, transactions and inspections. They appear under &ldquo;More details&rdquo; on those pages, where staff fill them in. A field&apos;s type can&apos;t change once it&apos;s made, and a field that&apos;s
        been filled in is turned off rather than deleted, so no one&apos;s data is lost.
      </p>
      <CustomFieldsManager
        fields={defs.map((d) => ({ id: d.id, entityType: d.entityType, label: d.label, fieldKey: d.fieldKey, dataType: d.dataType, options: d.options, required: d.required, active: d.active, valueCount: d.valueCount }))}
      />
    </div>
  );
}
