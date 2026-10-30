import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getBrand } from "@/lib/brand/service";
import { NEUTRAL_TONE_LABELS, SIDEBAR_STYLE_LABELS } from "@/lib/theme";
import { BrandingForm } from "./BrandingForm";

export default async function BrandingPage() {
  const session = await auth();
  if (!can(session?.user?.role as Role | undefined, "branding:manage")) {
    return <p className="text-sm text-neutral-600">Only an owner can change the company branding.</p>;
  }
  const brand = await getBrand();
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Branding</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your logo, name, colors and contact details. They appear on inspection report PDFs, the report and agreement pages customers open, every email, and the staff app. Report PDFs already finalized keep the branding they were made with.
      </p>
      <BrandingForm
        brand={{
          companyName: brand.companyName,
          phone: brand.phone ?? "",
          website: brand.website ?? "",
          mailingAddress: brand.mailingAddress ?? "",
          brandColor: brand.theme?.brand ?? "",
          neutral: brand.theme?.neutral ?? "cool",
          sidebar: brand.theme?.sidebar ?? "light",
          effectiveColor: brand.brandColor,
          logo: brand.logo,
          icon: brand.icon,
        }}
        neutralLabels={NEUTRAL_TONE_LABELS}
        sidebarLabels={SIDEBAR_STYLE_LABELS}
      />
    </div>
  );
}
