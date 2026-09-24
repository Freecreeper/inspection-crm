import { describe, it, expect } from "vitest";
import { digitsOnly, isValidPhoneInput, formatPhone } from "./phone";

describe("digitsOnly", () => {
  it("strips everything but digits", () => {
    expect(digitsOnly("(828) 555-0101")).toBe("8285550101");
  });
});

describe("isValidPhoneInput", () => {
  it("accepts an empty value — phone is optional", () => {
    expect(isValidPhoneInput("")).toBe(true);
  });

  it("accepts exactly 10 digits, formatted or not", () => {
    expect(isValidPhoneInput("8285550101")).toBe(true);
    expect(isValidPhoneInput("(828) 555-0101")).toBe(true);
  });

  it("rejects anything other than 0 or 10 digits", () => {
    expect(isValidPhoneInput("828555010")).toBe(false);
    expect(isValidPhoneInput("82855501011")).toBe(false);
    expect(isValidPhoneInput("555")).toBe(false);
  });
});

describe("formatPhone", () => {
  it("formats 10 digits as (xxx)xxx-xxxx", () => {
    expect(formatPhone("8285550101")).toBe("(828)555-0101");
  });

  it("re-formats an already-formatted or punctuated value the same way", () => {
    expect(formatPhone("828-555-0101")).toBe("(828)555-0101");
  });

  it("returns the raw digits for an incomplete number rather than a broken format", () => {
    expect(formatPhone("828555")).toBe("828555");
  });

  it("returns an empty string for null/empty input", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });
});
