import Link from "next/link";
import { findResetToken } from "@/lib/security/passwordReset";
import { ResetForm } from "./ResetForm";

// Public, opened from the emailed link. Shows the form only for a link
// that's still usable.
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await findResetToken(token);
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Inspection CRM</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Choose a new password</h1>
        {valid ? (
          <ResetForm token={token} />
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">This reset link has expired or was already used.</p>
            <Link href="/forgot-password" className="inline-block text-emerald-700 hover:underline">
              Get a new link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
