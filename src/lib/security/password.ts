import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordProblem } from "./passwordRules";

export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

// A readable one-time password for new users and admin resets
// (no 0/O/1/l/I lookalikes), ~95 bits.
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

// Compared against when the email isn't a usable account, so an unknown
// email takes as long as a wrong password and doesn't reveal which
// accounts exist. A real bcrypt hash (of random bytes nobody knows), made
// once per process at the same cost as real passwords.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  return (dummyHash ??= bcrypt.hash(randomBytes(24).toString("hex"), BCRYPT_COST));
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? (await dummyPasswordHash()));
  return Boolean(hash) && ok;
}
