import type { CustomFieldEntityType, Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { canEditCustomFields, loadRecordFields } from "@/lib/customFields/service";
import { CustomFieldsPanel } from "./CustomFieldsPanel";

// Drop-in for a record page: renders that record's custom fields, or
// nothing when its kind has none set up.
export async function CustomFieldsSection({ entityType, entityId, title = "More details", bare = false }: { entityType: CustomFieldEntityType; entityId: string; title?: string; bare?: boolean }) {
  const [fields, session] = await Promise.all([loadRecordFields(entityType, entityId), auth()]);
  if (fields.length === 0) return null;
  return <CustomFieldsPanel entityType={entityType} entityId={entityId} title={title} fields={fields} canEdit={canEditCustomFields(session?.user?.role as Role | undefined, entityType)} bare={bare} />;
}
