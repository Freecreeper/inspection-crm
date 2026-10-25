// Runs once when the server starts. Refuses to serve with a configuration
// that would be unsafe in production (see src/lib/security/env.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnvironment } = await import("./lib/security/env");
  assertEnvironment("app");
}
