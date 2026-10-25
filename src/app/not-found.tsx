import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Not found</h1>
        <p className="mt-1 text-sm text-slate-600">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/dashboard" className="mt-4 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
          Go to the Dashboard
        </Link>
      </div>
    </main>
  );
}
