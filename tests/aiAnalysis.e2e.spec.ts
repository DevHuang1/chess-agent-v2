import { expect, test } from "@playwright/test";

test("opens the connected AI minimax analysis tab", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  await expect(page.getByRole("button", { name: "Collapse game controller" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse game controller" }).click();
  await expect(page.getByRole("button", { name: "Expand game controller" })).toBeVisible();
  await page.getByRole("button", { name: "Expand game controller" }).click();
  await expect(page.getByRole("button", { name: "Collapse game controller" })).toBeVisible();

  await page.getByRole("button", { name: "AI Lab" }).click();
  await expect(page.getByText("Minimax Flight Recorder", { exact: true })).toBeVisible();
  await expect(page.getByText("Position under analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("Search tree", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByLabel("Minimax depth")).toHaveValue("3");

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "MCTS" }).click();
  await expect(page.getByText("MCTS Rollout Observatory", { exact: true })).toBeVisible();
  await expect(page.getByText("rollouts", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "3D Graph" }).click();
  await expect(page.getByLabel("3D minimax decision tree")).toBeVisible();
  await expect(page.getByLabel("AI Lab graph overview navigator")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset view" })).toBeVisible();
  await expect(page.getByText("3D MCTS rollout graph", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText("Position under analysis", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Benchmarks" }).click();
  await expect(page.getByText("Search Benchmarks", { exact: true })).toBeVisible();
  await expect(page.getByText("Depth scaling", { exact: true })).toBeVisible();
  await expect(page.getByText("Minimax avg", { exact: true })).toBeVisible();
  await expect(page.getByText("MCTS avg", { exact: true })).toBeVisible();
  await page.getByLabel("Metric").selectOption("workUnitsPerSecond");
  await expect(page.getByLabel("Metric")).toHaveValue("workUnitsPerSecond");

  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByText("3D Arena Active", { exact: false })).toBeVisible();
  await expect(page.locator("#replay-game-select")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay previous move" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay next move" })).toBeVisible();
});
