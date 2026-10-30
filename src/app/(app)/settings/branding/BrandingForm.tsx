"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrandMark, PlaceholderMark } from "@/components/brand/BrandMark";
import { DEFAULT_BRAND_COLOR, normalizeBrandColor } from "@/lib/brand/shared";
import { removeBrandAssetAction, saveBrandDetailsAction, uploadBrandAssetAction } from "./actions";

type Asset = { url: string; width: number; height: number } | null;

interface FormBrand {
  companyName: string;
  phone: string;
  website: string;
  mailingAddress: string;
  brandColor: string; // "" = built-in colors
  neutral: string;
  sidebar: string;
  effectiveColor: string;
  logo: Asset;
  icon: Asset;
}

const input = "mt-1 w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const label = "block text-xs font-medium text-neutral-700";
const secondary = "rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover disabled:opacity-60";

export function BrandingForm({ brand, neutralLabels, sidebarLabels }: { brand: FormBrand; neutralLabels: Record<string, string>; sidebarLabels: Record<string, string> }) {
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState(brand);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof FormBrand) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const previewColor = normalizeBrandColor(form.brandColor) ?? DEFAULT_BRAND_COLOR;
  const preview = { companyName: form.companyName || "Company name", brandColor: previewColor, logo: brand.logo };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return setMessage({ ok: false, text: result.error ?? "Couldn't save." });
        setMessage({ ok: true, text: success });
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "Couldn't save. Only an owner can change the branding." });
      }
    });
  };

  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby={`${id}-preview`} className="rounded-lg border border-border bg-surface p-4">
        <h2 id={`${id}-preview`} className="text-sm font-semibold text-foreground">
          Preview
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Fixed colors, not theme tokens: these samples must look the same in light or dark mode. */}
          <div className="rounded-md border border-border p-4" style={{ background: "#ffffff" }}>
            <BrandMark brand={preview} nameClassName="text-base font-semibold [color:#0f172a]" />
            <p className="mt-2 text-xs [color:#64748b]">On light backgrounds (reports, emails, pages)</p>
          </div>
          <div className="rounded-md p-4" style={{ background: "#18181b" }}>
            <BrandMark brand={preview} tile nameClassName="text-base font-semibold [color:#ffffff]" />
            <p className="mt-2 text-xs [color:#a1a1aa]">On dark backgrounds{brand.logo ? " (shown on a white tile)" : ""}</p>
          </div>
        </div>
        {!brand.logo && <p className="mt-3 text-xs text-muted-foreground">No logo yet: the house mark in your brand color, next to the company name, stands in for it everywhere.</p>}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <ImageUpload
          kind="logo"
          title="Logo"
          hint="PNG with a transparent background is best, at least 600 pixels wide. PNG or JPG, under 1 MB."
          asset={brand.logo}
          disabled={pending}
          onUpload={(fd) => run(() => uploadBrandAssetAction("logo", fd), "Logo uploaded.")}
          onRemove={() => run(() => removeBrandAssetAction("logo"), "Logo removed; the placeholder is back.")}
        />
        <ImageUpload
          kind="icon"
          title="Browser icon"
          hint="Square, 256 × 256 pixels or larger. Shown in browser tabs and bookmarks. PNG or JPG, under 1 MB."
          asset={brand.icon}
          fallback={<PlaceholderMark color={previewColor} size={56} />}
          disabled={pending}
          onUpload={(fd) => run(() => uploadBrandAssetAction("icon", fd), "Icon uploaded.")}
          onRemove={() => run(() => removeBrandAssetAction("icon"), "Icon removed; the placeholder is back.")}
        />
      </div>

      <form
        className="space-y-4 rounded-lg border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveBrandDetailsAction(form), "Saved.");
        }}
      >
        <h2 className="text-sm font-semibold text-foreground">Company details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Company name
            <input value={form.companyName} maxLength={100} disabled={pending} onChange={set("companyName")} className={input} required />
          </label>
          <label className={label}>
            Phone
            <input value={form.phone} maxLength={40} disabled={pending} onChange={set("phone")} className={input} placeholder="(828) 555-0100" />
          </label>
          <label className={label}>
            Website
            <input value={form.website} maxLength={200} disabled={pending} onChange={set("website")} className={input} placeholder="https://example.com" />
          </label>
          <label className={label}>
            Mailing address
            <input value={form.mailingAddress} maxLength={300} disabled={pending} onChange={set("mailingAddress")} className={input} placeholder="123 Main St, Hickory, NC 28601" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">These are the same details as in Email → Settings; changing them here changes them there.</p>

        <h2 className="pt-2 text-sm font-semibold text-foreground">Colors</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={label}>
            Brand color
            <div className="mt-1 flex items-center gap-2">
              <input type="color" aria-label="Pick a brand color" value={previewColor} disabled={pending} onChange={set("brandColor")} className="h-9 w-12 cursor-pointer rounded border border-input bg-surface" />
              <input aria-label="Brand color hex code" value={form.brandColor} maxLength={7} disabled={pending} onChange={set("brandColor")} placeholder="Built-in" className={`${input} mt-0 font-mono`} />
            </div>
          </div>
          <label className={label}>
            Grays
            <select value={form.neutral} disabled={pending || !form.brandColor} onChange={set("neutral")} className={input}>
              {Object.entries(neutralLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Sidebar
            <select value={form.sidebar} disabled={pending || !form.brandColor} onChange={set("sidebar")} className={input}>
              {Object.entries(sidebarLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Used for the placeholder mark, email headers and report accents, and as everyone&apos;s default app colors (staff can still pick their own under Appearance). Text and buttons are contrast-checked, so any color stays readable.{" "}
          {form.brandColor && (
            <button type="button" className="text-info-strong hover:underline" disabled={pending} onClick={() => setForm((f) => ({ ...f, brandColor: "" }))}>
              Use the built-in colors
            </button>
          )}
        </p>

        {message && (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-success-strong" : "text-danger-strong"}`}>
            {message.text}
          </p>
        )}
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save details and colors"}
        </button>
      </form>
    </div>
  );
}

function ImageUpload({
  kind,
  title,
  hint,
  asset,
  fallback,
  disabled,
  onUpload,
  onRemove,
}: {
  kind: string;
  title: string;
  hint: string;
  asset: Asset;
  fallback?: React.ReactNode;
  disabled: boolean;
  onUpload: (fd: FormData) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-3 flex h-20 items-center justify-center rounded-md border border-dashed border-input p-2" style={{ background: "#ffffff" }}>
        {asset ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview of the uploaded image
          <img src={asset.url} alt={`Current ${title.toLowerCase()}`} className="max-h-16 max-w-full object-contain" />
        ) : (
          (fallback ?? <span className="text-xs [color:#64748b]">No {title.toLowerCase()} yet: placeholder in use</span>)
        )}
      </div>
      {asset && (
        <p className="mt-1 text-xs text-muted-foreground">
          {asset.width} × {asset.height} px
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      <input
        ref={ref}
        id={`${id}-file`}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("file", file);
          onUpload(fd);
          e.target.value = "";
        }}
        data-kind={kind}
      />
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className={secondary}>
          {asset ? "Replace" : "Upload"}
        </button>
        {asset && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`Remove the ${title.toLowerCase()}? The placeholder will be used instead.`)) onRemove();
            }}
            className={secondary}
          >
            Remove
          </button>
        )}
      </div>
    </section>
  );
}
