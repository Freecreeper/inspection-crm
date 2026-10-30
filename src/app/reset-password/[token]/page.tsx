import Link from "next/link";
import { findResetToken } from "@/lib/security/passwordReset";
import { ResetForm } from "./ResetForm";
import { SignInBrand } from "@/components/brand/PublicBrandHeader";

// Public, opened from the emailed link. Shows the form only for a link
// that's still usable.
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await findResetToken(token);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
        <SignInBrand />
        <h1 className="mt-1 text-xl font-semibold text-foreground">Choose a new password</h1>
        {valid ? (
          <ResetForm token={token} />
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <p className="rounded-md bg-warning-soft px-3 py-2 text-warning-strong">This reset link has expired or was already used.</p>
            <Link href="/forgot-password" className="inline-block text-link hover:underline">
              Get a new link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
