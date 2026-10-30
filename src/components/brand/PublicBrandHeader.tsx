import { getBrand } from "@/lib/brand/service";
import { BrandContactLine, BrandMark, type BrandProps } from "./BrandMark";

// The company header on pages customers and Realtors open from a link
// (report, agreement, email preferences): logo or placeholder, and how to
// reach the company.
export async function PublicBrandHeader() {
  const brand = await getBrand();
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <BrandMark brand={toBrandProps(brand)} tile />
      <BrandContactLine phone={brand.phone} website={brand.website} />
    </header>
  );
}

export function toBrandProps(brand: { companyName: string; brandColor: string; logo: { url: string; width: number; height: number } | null }): BrandProps {
  return { companyName: brand.companyName, brandColor: brand.brandColor, logo: brand.logo ? { url: brand.logo.url, width: brand.logo.width, height: brand.logo.height } : null };
}
