import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="max-w-sm rounded-lg border border-neutral-200 bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Not found</h1>
        <p className="mt-1 text-sm text-neutral-600">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/dashboard" className="mt-4 inline-block rounded-md bg-neutral-solid-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-solid-800">
          Go to the Dashboard
        </Link>
      </div>
    </main>
  );
}
