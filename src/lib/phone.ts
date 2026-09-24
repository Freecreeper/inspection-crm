// A single source of truth for US phone number handling: stored as exactly
// 10 digits (no formatting, no country code) so every display site can
// format it the same way, and so validation is one string check instead of
// a regex duplicated everywhere a phone field is edited.

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

// Empty is valid (phone is optional everywhere it's used) — only a
// non-empty value that isn't exactly 10 digits is rejected.
export function isValidPhoneInput(input: string): boolean {
  const digits = digitsOnly(input);
  return digits.length === 0 || digits.length === 10;
}

// (xxx)xxx-xxxx — for a partial value (still being typed, or malformed
// legacy data), returns the raw digits typed so far rather than a
// half-formatted string.
export function formatPhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = digitsOnly(input).slice(0, 10);
  if (digits.length < 10) return digits;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}
