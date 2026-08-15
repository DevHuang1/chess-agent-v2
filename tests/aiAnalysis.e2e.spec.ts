import { expect, test } from "@playwright/test";

test("opens the connected AI minimax analysis tab", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "AI Lab" }).click();
  await expect(page.getByText("Minimax Flight Recorder", { exact: true })).toBeVisible();
  await expect(page.getByText("Position under analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("Search tree", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByLabel("Minimax depth")).toHaveValue("3");

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  await page.getByRole("button", { name: "3D Graph" }).click();
  await expect(page.getByLabel("3D minimax decision tree")).toBeVisible();
  await expect(page.getByText("3D decision graph", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText("Position under analysis", { exact: true })).toBeVisible();
});
