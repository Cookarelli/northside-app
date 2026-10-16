import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
process.loadEnvFile(".env.local");
if (process.env.COMMERCE_MODE !== "fixture")
  throw new Error("This verification requires the local fixture profile.");
const base = "http://127.0.0.1:3100";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const evidence = {
  at: new Date().toISOString(),
  mode: "LOCAL FIXTURE — no real payments",
  checks: [] as string[],
  pageErrors: [] as string[],
};
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const staffContext = await browser.newContext({
  viewport: { width: 1024, height: 1366 },
  hasTouch: true,
});
const phonePage = await phone.newPage();
const staff = await staffContext.newPage();
for (const page of [phonePage, staff])
  page.on("pageerror", (e) => evidence.pageErrors.push(e.message));
await mkdir("docs/evidence", { recursive: true });
try {
  await phonePage.goto(`${base}/in-store/q/N001`);
  await expect(
    phonePage.getByRole("button", { name: "Add to basket +" }),
  ).toBeEnabled();
  await expect(
    phonePage.getByRole("link", { name: "Basket 0", exact: true }),
  ).toBeVisible();
  await phonePage.getByLabel("Quantity", { exact: true }).fill("2");
  await phonePage.screenshot({
    path: "docs/evidence/phone-product.png",
    fullPage: true,
  });
  await phonePage.getByRole("button", { name: "Add to basket +" }).click();
  await expect(
    phonePage.getByText("Added to your basket.", { exact: false }),
  ).toBeVisible();
  await phonePage
    .getByRole("link", { name: "View basket →", exact: true })
    .click();
  await phonePage.getByRole("combobox").selectOption("1");
  await expect(
    phonePage.getByRole("heading", { name: "Your basket (1)" }),
  ).toBeVisible();
  await phonePage.getByRole("button", { name: "Pay now with Shopify" }).click();
  await expect(phonePage.locator(".notice")).toContainText(/Shopify|checkout/);
  await phonePage.screenshot({
    path: "docs/evidence/phone-basket.png",
    fullPage: true,
  });
  evidence.checks.push(
    "Phone: exact product QR confirms without adding; quantity edit; checkout setup gate visible.",
  );
  await phonePage.getByRole("button", { name: "Pay at counter" }).click();
  await expect(
    phonePage.getByRole("heading", { name: "Waiting for counter payment" }),
  ).toBeVisible();
  const handoff = await phonePage.locator(".fallback-code").innerText();
  await expect(
    phonePage.getByAltText("Unpaid counter handoff QR"),
  ).toBeVisible();
  const current = await (
    await phone.request.get(`${base}/api/in-store/session`)
  ).json();
  await staff.goto(`${base}/in-store/staff`);
  await staff
    .getByLabel("Staff password", { exact: true })
    .fill(process.env.STAFF_PASSWORD!);
  await staff.getByRole("button", { name: "Open staff queue" }).click();
  await staff
    .getByLabel("Open an unpaid handoff", { exact: true })
    .fill(handoff);
  await staff.getByRole("button", { name: "Look up basket" }).click();
  await staff
    .getByRole("button", { name: "Claim handoff for counter" })
    .click();
  await expect(
    staff.getByRole("button", { name: "Claimed — do not import again" }),
  ).toBeDisabled();
  const card = staff
    .locator(".queue-card")
    .filter({ hasText: current.id.slice(0, 8) });
  await card.getByRole("button", { name: "Simulate fixture payment" }).click();
  await expect(
    card.getByRole("heading", { name: "Payment confirmed · preparing" }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Mark ready for collection" }).click();
  await expect(
    card.getByRole("heading", { name: "Ready to collect" }),
  ).toBeVisible();
  await phonePage.reload();
  await expect(
    phonePage.getByRole("heading", { name: "Ready to collect" }),
  ).toBeVisible();
  const collection = await phonePage.locator(".fallback-code").innerText();
  if (collection === handoff)
    throw new Error("Payment and collection reference must differ");
  await phonePage.screenshot({
    path: "docs/evidence/phone-collection.png",
    fullPage: true,
  });
  await card.getByLabel("Customer collection code").fill(collection);
  await card.getByRole("button", { name: "Verify & collect once" }).click();
  await expect(card.getByText("✓ Collection recorded")).toBeVisible();
  await staff.screenshot({
    path: "docs/evidence/ipad-staff.png",
    fullPage: true,
  });
  await phonePage.reload();
  await expect(
    phonePage.getByRole("heading", { name: "Collected. Enjoy your finds!" }),
  ).toBeVisible();
  evidence.checks.push(
    "Counter journey: authenticated staff lookup, single claim, explicitly simulated payment, preparation, separate collection code, successful one-time collection.",
  );
  const ipad = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    hasTouch: true,
  });
  const tablet = await ipad.newPage();
  tablet.on("pageerror", (e) => evidence.pageErrors.push(e.message));
  await tablet.goto(`${base}/in-store?shared=1`);
  await expect(
    tablet.getByText("Shared iPad · Clears after 3 minutes of inactivity"),
  ).toBeVisible();
  await tablet.goto(`${base}/in-store/q/N001`);
  await tablet.getByRole("button", { name: "Add to basket +" }).click();
  await expect(
    tablet.getByRole("link", { name: "Basket 1", exact: true }),
  ).toBeVisible();
  await tablet.reload();
  await expect(
    tablet.getByText("Shared iPad · Clears after 3 minutes of inactivity"),
  ).toBeVisible();
  await tablet.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(
    tablet.getByRole("link", { name: "Basket 0", exact: true }),
  ).toBeVisible();
  await tablet.getByRole("button", { name: "Add to basket +" }).click();
  await expect(
    tablet.getByRole("link", { name: "Basket 1", exact: true }),
  ).toBeVisible();
  await tablet.clock.install();
  await tablet.clock.fastForward(181000);
  await expect(
    tablet.getByRole("link", { name: "Basket 0", exact: true }),
  ).toBeVisible();
  await expect(tablet.locator(".notice")).toContainText(
    "cleared after inactivity",
  );
  await tablet.goto(`${base}/in-store`);
  await expect(
    tablet.getByText("Shared iPad · Clears after 3 minutes of inactivity"),
  ).toBeVisible();
  await expect(
    tablet.getByRole("heading", { name: "Rookie Series" }),
  ).toBeVisible();
  await expect(tablet.locator(".prototype-bar")).toContainText(
    "LOCAL FIXTURE EXPERIENCE",
  );
  await tablet.screenshot({
    path: "docs/evidence/ipad-shared.png",
    fullPage: true,
  });
  evidence.checks.push(
    "iPad: shared flag survives reload, Start over clears basket, accelerated browser clock verifies 3-minute inactivity reset.",
  );
  for (const page of [phonePage, staff, tablet]) {
    const size = await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    if (size.content > size.width)
      throw new Error(`Horizontal overflow ${JSON.stringify(size)}`);
  }
  await tablet.goto(`${base}/`);
  await expect(tablet.locator("main")).toBeVisible();
  await tablet.screenshot({
    path: "docs/evidence/existing-shell.png",
    fullPage: true,
  });
  evidence.checks.push(
    "Preserved existing customer root renders; phone/iPad rehearsal pages have no horizontal overflow.",
  );
  if (evidence.pageErrors.length)
    throw new Error(evidence.pageErrors.join("\n"));
  await writeFile(
    "docs/evidence/browser.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
