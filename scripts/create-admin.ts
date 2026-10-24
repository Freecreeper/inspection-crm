import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

// Creates an OWNER_ADMIN login, or resets the password of an existing one. Production has no
// seeded logins (see prisma/seed.ts), so this is how the first person gets in:
//   npx tsx scripts/create-admin.ts you@example.com "Your Name"
// Uses ADMIN_PASSWORD if set, otherwise generates one and prints it once.
const [emailArg, name = "Owner"] = process.argv.slice(2);
if (!emailArg) {
  console.error('Usage: npx tsx scripts/create-admin.ts <email> ["Full Name"]');
  process.exit(1);
}
const email = emailArg.toLowerCase();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = process.env.ADMIN_PASSWORD || randomBytes(15).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, active: true },
    create: { email, name, passwordHash, role: "OWNER_ADMIN" },
  });
  console.log(`Admin login ready: ${email}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Password: ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
