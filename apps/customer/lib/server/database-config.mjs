/**
 * Explicit pg options prevent URL parameters from replacing verified TLS.
 * @param {string} value
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {import("pg").PoolConfig}
 */
export function databaseConfig(value, environment = process.env) {
  try {
    if (!value || value !== value.trim()) throw new Error();
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname || !url.username ||
      !url.pathname.startsWith("/") || url.pathname.length < 2 || url.hash
    ) throw new Error();

    // No driver options, certificate file paths, or endpoint overrides. Accept
    // provider sslmode=require spelling but always verify the remote certificate.
    const parameters = [...url.searchParams];
    if (parameters.length > 1 || parameters.some(([key]) => key !== "sslmode"))
      throw new Error();
    const mode = url.searchParams.get("sslmode");
    if (mode !== null && !["require", "verify-full", "disable"].includes(mode))
      throw new Error();
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const localPlaintext =
      ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase()) &&
      ["development", "test"].includes(environment.NODE_ENV ?? "") &&
      environment.NORTHSIDE_ALLOW_INSECURE_LOCAL_DATABASE === "1" &&
      !environment.VERCEL;
    if (mode === "disable" && !localPlaintext) throw new Error();
    const password = decodeURIComponent(url.password);
    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    return {
      host,
      port,
      user: decodeURIComponent(url.username),
      // The callback prevents an empty URL password from falling back to an
      // unrelated PGPASSWORD credential in the environment.
      password: password || (() => ""),
      database: decodeURIComponent(url.pathname.slice(1)),
      ssl: localPlaintext && (mode === null || mode === "disable")
        ? false : { rejectUnauthorized: true },
      sslnegotiation: "postgres",
    };
  } catch {
    // URL/parser errors can contain the connection URL. Never propagate them.
    throw new Error("Invalid database connection configuration.");
  }
}
