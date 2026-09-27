import { prisma } from "@/lib/prisma";
import { getEmailSettings } from "@/lib/email/settings";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { PreferenceToggles } from "./PreferenceToggles";

export const metadata = { title: "Email preferences" };

// Reached from the link in a relationship or marketing email. GET only
// displays — changes need a button press, so link scanners can't
// unsubscribe anyone.
export default async function EmailPreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyUnsubscribeToken(token);
  const realtor = verified ? await prisma.realtor.findUnique({ where: { id: verified.realtorId } }) : null;
  const settings = await getEmailSettings();

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-xl font-semibold text-slate-900">Email preferences</h1>
      <p className="mt-1 text-sm text-slate-500">{settings.companyName}</p>
      {!realtor ? (
        <p className="mt-6 text-sm text-slate-700">This link isn&apos;t valid. If you&apos;d like to change the emails you receive, reply to any of our emails.</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-slate-700">
            Hi {realtor.preferredName || realtor.firstName} — choose which emails you&apos;d like from us. Emails about inspections you&apos;re part of aren&apos;t affected.
          </p>
          <PreferenceToggles
            token={token}
            highlight={verified!.scope}
            marketing={!realtor.marketingUnsubscribedAt && realtor.marketingOptIn}
            relationship={realtor.relationshipEmailsEnabled}
          />
        </>
      )}
    </main>
  );
}
