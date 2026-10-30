import { HOUSE_PATHS, textOnBrand } from "@/lib/brand/shared";

// Client-safe props: what a page needs to draw the brand.
export interface BrandProps {
  companyName: string;
  brandColor: string;
  logo: { url: string; width: number; height: number } | null;
}

// The company logo, or — until one is uploaded — the placeholder: a house
// on a square in the brand color, next to the company name. `tile` puts an
// uploaded logo on a white rounded tile so it reads on dark backgrounds.
export function BrandMark({ brand, height = 36, showName = true, tile = false, nameClassName = "text-base font-semibold text-foreground" }: { brand: BrandProps; height?: number; showName?: boolean; tile?: boolean; nameClassName?: string }) {
  if (brand.logo) {
    const width = Math.round((brand.logo.width / brand.logo.height) * height);
    // eslint-disable-next-line @next/next/no-img-element -- a small, already-sized uploaded image served by this app
    const img = <img src={brand.logo.url} alt={brand.companyName} width={width} height={height} style={{ height, width: "auto", maxWidth: "100%" }} className="block object-contain" />;
    return tile ? <span className="inline-flex rounded-md bg-white px-2 py-1">{img}</span> : img;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <PlaceholderMark color={brand.brandColor} size={height} />
      {showName && <span className={`truncate ${nameClassName}`}>{brand.companyName}</span>}
    </span>
  );
}

export function PlaceholderMark({ color, size = 36, label }: { color: string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="shrink-0">
      <rect width="32" height="32" rx="7" fill={color} />
      <g transform="translate(5.6 5.6) scale(0.867)" fill="none" stroke={textOnBrand(color)} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        {HOUSE_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

// A one-line company footer for customer-facing pages.
export function BrandContactLine({ phone, website, className = "text-xs text-muted-foreground" }: { phone: string | null; website: string | null; className?: string }) {
  if (!phone && !website) return null;
  return (
    <p className={className}>
      {phone}
      {phone && website && " · "}
      {website && (
        <a href={website} className="hover:underline" rel="noopener noreferrer">
          {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      )}
    </p>
  );
}
