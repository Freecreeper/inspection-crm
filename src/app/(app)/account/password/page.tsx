import { auth } from "@/lib/auth";
import { PasswordForm } from "./PasswordForm";

export default async function ChangePasswordPage() {
  const session = await auth();
  const mustChange = Boolean(session?.user?.mustChangePassword);
  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold text-foreground">Change password</h1>
      {mustChange ? (
        <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">You signed in with a temporary password. Choose your own to continue.</p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">You&apos;ll be signed out everywhere and sign in again with the new password.</p>
      )}
      <PasswordForm />
    </div>
  );
}
