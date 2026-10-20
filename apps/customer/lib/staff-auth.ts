export type StaffAuthStep = "request" | "confirm";

const steps = {
  request: {
    endpoint: "/api/auth/staff/request",
    destination: "/staff/login?requested=1",
  },
  confirm: { endpoint: "/api/auth/staff/callback", destination: "/staff" },
} as const;

export async function submitStaffAuth(
  step: StaffAuthStep,
  form: FormData,
  send: typeof fetch = fetch,
) {
  const { endpoint, destination } = steps[step];
  const response = await send(endpoint, {
    method: "POST",
    body: form,
    // CORS-mode POSTs retain Origin even under the page's no-referrer policy.
    mode: "cors",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok || (await response.json()).ok !== true)
    throw Error("staff_sign_in_failed");
  return destination;
}
