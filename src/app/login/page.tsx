import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { AuthError, CredentialsSignin } from "next-auth";
import { safeRedirectPath } from "@/lib/security/redirects";

const MESSAGES: Record<string, { tone: "error" | "info"; text: string }> = {
  "1": { tone: "error", text: "Incorrect email or password." },
  locked: { tone: "error", text: "Too many sign-in attempts. Wait 15 minutes and try again." },
  changed: { tone: "info", text: "Password changed. Sign in with your new password." },
  reset: { tone: "info", text: "Your password was reset. Sign in with your new password." },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  // Only a same-site path ever reaches the form (no //evil.example).
  const from = params.from ? safeRedirectPath(params.from) : "";
  const message = MESSAGES[params.error ?? ""] ?? MESSAGES[params.notice ?? ""] ?? null;

  async function login(formData: FormData) {
    "use server";
    const target = safeRedirectPath(formData.get("from"));
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: target,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        const code = err instanceof CredentialsSignin && err.code === "locked" ? "locked" : "1";
        redirect(`/login?error=${code}${target !== "/dashboard" ? `&from=${encodeURIComponent(target)}` : ""}`);
      }
      throw err;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Inspection CRM</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Staff sign in</h1>

        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`mt-4 rounded-md px-3 py-2 text-sm ${message.tone === "error" ? "bg-danger-soft text-danger-strong" : "bg-success-soft text-success-strong"}`}>
            {message.text}
          </p>
        )}

        <form action={login} className="mt-6 space-y-4">
          <input type="hidden" name="from" value={from} />
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-neutral-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/forgot-password" className="text-link hover:underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </div>
  );
}
