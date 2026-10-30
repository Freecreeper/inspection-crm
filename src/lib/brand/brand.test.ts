import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { checkBrandImage, normalizeBrandColor, placeholderMarkSvg, sniffImage, textOnBrand } from "./shared";
import { brandedEmailHtml, type EmailBrand } from "@/lib/email/render";

// Real (tiny) image headers, built byte by byte.
function png(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(1))), chunk("IEND", Buffer.alloc(0))]));
}

function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

describe("uploaded images", () => {
  it("reads the real type and size from the bytes", () => {
    expect(sniffImage(png(800, 200))).toEqual({ type: "image/png", width: 800, height: 200 });
    expect(sniffImage(jpeg(640, 480))).toEqual({ type: "image/jpeg", width: 640, height: 480 });
  });

  it("refuses SVG, GIF, renamed text and empty files", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000"))).toBeNull();
    expect(checkBrandImage("logo", svg)).toMatchObject({ ok: false, error: expect.stringContaining("PNG or JPG") });
    expect(checkBrandImage("logo", new Uint8Array())).toMatchObject({ ok: false });
  });

  it("logos must be big enough to look sharp; icons must be square", () => {
    expect(checkBrandImage("logo", png(800, 200))).toMatchObject({ ok: true });
    expect(checkBrandImage("logo", png(80, 20))).toMatchObject({ ok: false, error: expect.stringContaining("600") });
    expect(checkBrandImage("icon", png(512, 512))).toMatchObject({ ok: true });
    expect(checkBrandImage("icon", png(800, 200))).toMatchObject({ ok: false, error: expect.stringContaining("square") });
    expect(checkBrandImage("icon", png(32, 32))).toMatchObject({ ok: false });
  });

  it("caps the file size", () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(png(800, 200));
    expect(checkBrandImage("logo", big)).toMatchObject({ ok: false, error: expect.stringContaining("1 MB") });
  });
});

describe("brand colors", () => {
  it("accept only a six-digit hex color", () => {
    expect(normalizeBrandColor(" #1F5A3D ")).toBe("#1f5a3d");
    for (const bad of ["1f5a3d", "#fff", "red", "#12345g", null]) expect(normalizeBrandColor(bad)).toBeNull();
  });

  it("pick readable text for the mark", () => {
    expect(textOnBrand("#1f5a3d")).toBe("#ffffff");
    expect(textOnBrand("#f7e463")).toBe("#111827");
  });

  it("draw the placeholder mark in the brand color, never with injected markup", () => {
    expect(placeholderMarkSvg("#1f5a3d")).toContain('fill="#1f5a3d"');
    expect(placeholderMarkSvg('"/><script>')).toContain('fill="#1f7a5a"');
  });
});

describe("branded email HTML", () => {
  const brand: EmailBrand = { companyName: "Acme <Inspections>", brandColor: "#1f5a3d", logoUrl: null, phone: "(828) 555-0100", website: "https://acme.example.com/", mailingAddress: "1 Main St" };

  it("without a logo, heads the email with the company name (escaped) in the brand color, and adds a contact footer", () => {
    const html = brandedEmailHtml("Hi Gale,\n\nSee you Monday.", brand);
    expect(html).toContain('<span style="font-size:18px;font-weight:700;color:#1f5a3d">Acme &lt;Inspections&gt;</span>');
    expect(html).toContain("(828) 555-0100 · acme.example.com");
    expect(html).toContain("1 Main St");
    expect(html).not.toContain("<Inspections>");
  });

  it("with a logo, uses it at a fixed height with the company name as its alt text", () => {
    const html = brandedEmailHtml("Hi", { ...brand, logoUrl: "https://crm.example.com/brand/logo?v=abc", logoWidth: 800, logoHeight: 200 });
    expect(html).toContain('<img src="https://crm.example.com/brand/logo?v=abc" alt="Acme &lt;Inspections&gt;" height="40" width="160"');
  });
});
