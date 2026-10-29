import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { UsersManager } from "./UsersManager";

export default async function UsersPage() {
  const session = await auth();
  if (!can(session?.user?.role as Role | undefined, "user:manage")) {
    return <p className="text-sm text-neutral-600">Only an owner can manage staff accounts.</p>;
  }
  const rows = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true, createdAt: true },
  });
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-neutral-900">Users</h1>
      <p className="mt-1 text-sm text-neutral-500">Add staff, set their role, and deactivate people who leave. Deactivating signs them out everywhere immediately.</p>
      <UsersManager currentUserId={session!.user.id} users={rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))} />
    </div>
  );
}
