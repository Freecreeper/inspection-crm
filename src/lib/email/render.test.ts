import { describe, it, expect } from "vitest";
import { redactSendTime, referencedVariables, renderSubjectAndBody, renderTemplate, textToHtml } from "./render";

describe("renderTemplate", () => {
  it("resolves allowed variables from real values", () => {
    const r = renderTemplate("Hi {{customer.firstName}}, see you {{ inspection.date }} at {{inspection.time}}.", {
      "customer.firstName": "John",
      "inspection.date": "Thursday, October 3, 2026",
      "inspection.time": "9:00 AM",
    });
    expect(r.text).toBe("Hi John, see you Thursday, October 3, 2026 at 9:00 AM.");
    expect(r.missing).toEqual([]);
  });

  it("never invents a value: a missing field is reported and left in place", () => {
    const r = renderTemplate("Inspector: {{inspector.name}}", {});
    expect(r.text).toBe("Inspector: {{inspector.name}}");
    expect(r.missing).toEqual(["inspector.name"]);
  });

  it("uses only the fallback the template author wrote", () => {
    expect(renderTemplate('Inspector: {{inspector.name | "our inspector"}}', {}).text).toBe("Inspector: our inspector");
    expect(renderTemplate('Inspector: {{inspector.name | "our inspector"}}', { "inspector.name": "Jordan" }).text).toBe("Inspector: Jordan");
  });

  it("refuses anything that isn't an allow-listed field (no code, no arbitrary paths)", () => {
    const r = renderTemplate("{{process.env.AUTH_SECRET}} {{constructor.constructor}} {{customer.passwordHash}}", {
      "process.env.AUTH_SECRET": "leak",
    } as never);
    expect(r.text).toBe("{{process.env.AUTH_SECRET}} {{constructor.constructor}} {{customer.passwordHash}}");
    expect(r.unknown).toEqual(["process.env.AUTH_SECRET", "constructor.constructor", "customer.passwordHash"]);
  });

  it("defers send-time values unless explicitly resolving them at send", () => {
    const deferred = renderTemplate("Link: {{report.secureLink}}", { "report.secureLink": "https://x/r/abc" });
    expect(deferred.text).toBe("Link: {{report.secureLink}}");
    expect(deferred.deferred).toEqual(["report.secureLink"]);
    expect(renderTemplate("Link: {{report.secureLink}}", { "report.secureLink": "https://x/r/abc" }, { resolveSendTime: true }).text).toBe("Link: https://x/r/abc");
  });

  it("merges subject and body findings", () => {
    const r = renderSubjectAndBody("{{invoice.number}}", "{{invoice.balanceDue}} {{nope.field}}", { "invoice.number": "INV-1" });
    expect(r).toMatchObject({ subject: "INV-1", missing: ["invoice.balanceDue"], unknown: ["nope.field"] });
    expect(referencedVariables("{{a.b}} {{a.b}} {{c.d}}")).toEqual(["a.b", "c.d"]);
  });
});

describe("safety of rendered output", () => {
  it("never keeps a secure link in stored copy", () => {
    expect(redactSendTime("View: {{report.secureLink}}")).toBe("View: [secure link — created when sent]");
  });

  it("escapes values in HTML so a field can't inject markup", () => {
    const html = textToHtml('Hi <script>alert("x")</script>\n\nSee https://example.com/r/abc');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="https://example.com/r/abc">');
  });
});
