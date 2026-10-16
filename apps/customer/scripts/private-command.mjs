// Never print arbitrary provider/driver errors: their properties can contain URLs and secrets.
export class SetupError extends Error {}
export async function privateCommand(label, operation) {
  try {
    await operation();
  } catch (error) {
    console.error(
      error instanceof SetupError
        ? error.message
        : `${label} failed. Check private configuration and connectivity; error details withheld.`,
    );
    process.exitCode = 1;
  }
}
