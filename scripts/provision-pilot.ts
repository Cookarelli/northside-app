import { runProvisioning, safeFailure } from "./lib/pilot-provisioning";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--provision") || args.length > 1) {
  console.error(
    "Usage: node --import tsx scripts/provision-pilot.ts [--provision]",
  );
  process.exitCode = 1;
} else {
  try {
    const result = await runProvisioning(
      process.cwd(),
      args[0] === "--provision",
    );
    console.log(
      result.mode === "checked"
        ? `Read-only check passed: ${result.passwordlessRoles} passwordless roles; ${result.rolesNeedingLogin} roles awaiting LOGIN. No credentials generated or database changes made.`
        : "Role changes verified in the database catalog. Scoped private configuration files saved; runtime login checks remain required.",
    );
  } catch (error) {
    console.error(safeFailure(error));
    process.exitCode = 1;
  }
}
