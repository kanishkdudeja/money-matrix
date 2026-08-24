import { expect, test, type Page } from "@playwright/test";

test("records, classifies, reverses, imports, and reconciles real ledger activity", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const accountName = `E2E bank ${suffix}`;
  const bucketName = `E2E daily ${suffix}`;
  const categoryName = `E2E groceries ${suffix}`;
  const ruleName = `E2E merchant rule ${suffix}`;
  const profileName = `E2E CSV ${suffix}`;
  const merchant = `E2E MARKET ${suffix}`;

  await createAccount(page, accountName);
  await createBucket(page, bucketName);
  await createCategory(page, categoryName);
  await createRule(page, ruleName, merchant, bucketName, categoryName);
  await createParserProfile(page, profileName);

  await page.goto("/transactions/new");
  await page.getByLabel("Description").fill(`Manual groceries ${suffix}`);
  await page.getByLabel("Account").selectOption({ label: `${accountName} · Asset` });
  await page.getByLabel("Signed amount (₹)").first().fill("-12.34");
  await page.getByLabel("Bucket", { exact: true }).selectOption({ label: bucketName });
  await page.getByLabel(/Category/, { exact: true }).selectOption({ label: `${categoryName} · Expense` });
  await page.getByLabel("Signed amount (₹)").last().fill("-12.34");
  await page.getByRole("button", { name: "Post transaction" }).click();
  await expect(page.getByRole("heading", { name: `Manual groceries ${suffix}` })).toBeVisible();

  await page.getByRole("button", { name: "Reverse" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create reversal" }).click();
  await expect(page.getByRole("heading", { name: `Reversal of Manual groceries ${suffix}` })).toBeVisible();

  await page.goto("/imports/new");
  await page.getByLabel("Financial account").selectOption({ label: `${accountName} · Asset` });
  await page.getByLabel("CSV statement").setInputFiles({
    name: `e2e-${suffix}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(`Date,Description,Debit,Credit,Balance\n23/08/2026,${merchant},5.00,,0.00\n23/08/2026,Ignore ${suffix},1.00,,0.00\n`),
  });
  await page.getByLabel(/Saved mapping/).selectOption({ label: profileName });
  await page.getByRole("button", { name: "Upload and review" }).click();
  await expect(page.getByRole("heading", { level: 2, name: merchant })).toBeVisible();
  await page.getByRole("button", { name: ruleName }).click();
  await page.getByRole("button", { name: "Save categorization" }).click();
  await expect(page.getByRole("status")).toContainText("Categorization saved");
  await expect(page.getByRole("heading", { level: 2, name: `Ignore ${suffix}` })).toBeVisible();
  await page.keyboard.press("k");
  await expect(page.getByRole("heading", { level: 2, name: merchant })).toBeVisible();
  await page.keyboard.press("j");
  await page.getByRole("button", { name: "Skip row" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Skip row" }).click();
  await expect(page.getByRole("status")).toContainText("No actionable rows remain");

  await page.goto("/reconciliations");
  await page.getByRole("button", { name: "New reconciliation" }).click();
  const reconciliationDialog = page.getByRole("dialog");
  const accountOption = reconciliationDialog.getByLabel("Financial account").locator("option").filter({ hasText: accountName });
  await reconciliationDialog.getByLabel("Financial account").selectOption(await accountOption.getAttribute("value") ?? "");
  await reconciliationDialog.getByLabel("Statement ending date").fill("2026-08-23");
  await reconciliationDialog.getByLabel("Ending balance (₹)").fill("-6.00");
  await reconciliationDialog.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("status")).toContainText("draft created");

  const reconciliation = page.locator("article").filter({ hasText: accountName });
  await reconciliation.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Complete checkpoint" }).click();
  await expect(page.getByRole("status")).toContainText("completed through");
  await reconciliation.getByRole("button", { name: "Reopen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reopen checkpoint" }).click();
  await expect(page.getByRole("status")).toContainText("reopened through");
  await reconciliation.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Complete checkpoint" }).click();
  await expect(page.getByRole("status")).toContainText("completed through");
});

test("core text contrast holds in both themes and the workspace reflows at a 200%-equivalent viewport", async ({ page }) => {
  await page.goto("/");
  await assertThemeContrast(page);
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await assertThemeContrast(page);

  await page.setViewportSize({ width: 640, height: 450 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

async function createAccount(page: Page, name: string) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(`Account “${name}” created`);
}

async function createBucket(page: Page, name: string) {
  await page.goto("/buckets");
  await page.getByRole("button", { name: "Add bucket" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create bucket" }).click();
  await expect(page.getByRole("status")).toContainText(`Bucket “${name}” created`);
}

async function createCategory(page: Page, name: string) {
  await page.goto("/categories");
  await page.getByRole("button", { name: "Add category" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create category" }).click();
  await expect(page.getByRole("status")).toContainText(`Category “${name}” created`);
}

async function createRule(page: Page, name: string, merchant: string, bucket: string, category: string) {
  await page.goto("/rules");
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Rule name").fill(name);
  await dialog.getByLabel("Description contains").fill(merchant);
  await dialog.getByLabel(/Bucket/).selectOption({ label: bucket });
  await dialog.getByLabel(/Category/).selectOption({ label: `${category} · Expense` });
  await dialog.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByRole("status")).toContainText(`Rule “${name}” created`);
}

async function createParserProfile(page: Page, name: string) {
  await page.goto("/parser-profiles");
  await page.getByRole("button", { name: "New profile" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Profile name").fill(name);
  await dialog.getByLabel(/Sample CSV/).setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Debit,Credit,Balance\n"),
  });
  await dialog.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByRole("status")).toContainText(`Parser profile “${name}” created`);
}

async function assertThemeContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const value = (name: string) => styles.getPropertyValue(name).trim();
    const luminance = (color: string) => {
      const channels = color.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
      const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
    };
    const contrast = (foreground: string, background: string) => {
      const first = luminance(value(foreground));
      const second = luminance(value(background));
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    return [
      contrast("--ink", "--canvas"),
      contrast("--ink-muted", "--surface"),
      contrast("--primary", "--canvas"),
      contrast("--primary", "--primary-soft"),
      contrast("--warning", "--warning-soft"),
      contrast("--danger", "--danger-soft"),
    ];
  });
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
}
