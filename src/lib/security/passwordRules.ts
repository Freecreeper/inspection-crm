// Pure (client-safe).
// Password rules for staff logins. Length over complexity (NIST 800-63B):
// at least 12 characters, not the account's email, and not one of the
// passwords that appear in this repository or are commonly guessed.

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200; // bcrypt ignores bytes past 72; this just bounds input

const BLOCKED = new Set([
  "changeme123",
  "changeme1234",
  "changeme12345",
  "password",
  "password123",
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "letmein12345",
  "inspection123",
  "inspectioncrm",
]);

export function passwordProblem(password: string, ctx: { email?: string | null; current?: string | null } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (BLOCKED.has(lower)) return "That password is too common. Choose another.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  if (ctx.email && lower.includes(ctx.email.toLowerCase().split("@")[0]) && ctx.email.split("@")[0].length >= 4) {
    return "Don't include your email name in your password.";
  }
  if (ctx.current && password === ctx.current) return "Choose a password you haven't used here.";
  return null;
}
