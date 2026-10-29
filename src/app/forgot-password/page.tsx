import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/security/loginThrottle";
import { requestPasswordReset } from "@/lib/security/passwordReset";

// Public. Always answers the same way, so it can't be used to find out
// which emails have accounts.
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;

  async function request(formData: FormData) {
    "use server";
    await requestPasswordReset(String(formData.get("email") ?? ""), clientIp(await headers()));
    redirect("/forgot-password?sent=1");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-surface p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">Inspection CRM</p>
        <h1 className="mt-1 text-xl font-semibold text-neutral-900">Reset your password</h1>
        {sent ? (
          <div role="status" className="mt-4 space-y-3 text-sm text-neutral-700">
            <p className="rounded-md bg-accent-50 px-3 py-2 text-accent-900">
              If that email belongs to an account, we&apos;ve sent a link to choose a new password. It works for one hour.
            </p>
            <p>Nothing arrived after a few minutes? Check spam, or ask your account owner to reset it for you from the Users screen.</p>
          </div>
        ) : (
          <form action={request} className="mt-6 space-y-4">
            <p className="text-sm text-neutral-600">Enter the email you sign in with and we&apos;ll send you a reset link.</p>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
                Email
              </label>
              <input id="email" name="email" type="email" autoComplete="username" required className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <button type="submit" className="w-full rounded-md bg-neutral-solid-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-solid-800">
              Send reset link
            </button>
          </form>
        )}
        <p className="mt-6 text-xs text-neutral-500">
          Not sure which email you use? Your account owner can see it on the Users screen.{" "}
        </p>
        <Link href="/login" className="mt-3 inline-block text-sm text-accent-700 hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
