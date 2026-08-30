import { expect, test } from "@playwright/test";
import { chooseCustomOption } from "./helpers/customSelect";

test("opens the full-width live AI Lab workspace", async ({ page }) => {
  // This journey covers the controller, the AI Lab flight recorder, graph
  // views, benchmarks, and replay — give it room beyond the 30s default.
  test.setTimeout(120_000);
  await page.goto("/?e2e=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Board", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Lab", exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Collapse game controller" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse game controller" }).click();
  await expect(page.getByRole("button", { name: "Expand game controller" })).toBeVisible();
  await page.getByRole("button", { name: "Expand game controller" }).click();

  // Float and re-dock the controller sidebar via the overflow menu.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Float sidebar" }).click();
  await expect(page.locator('aside[data-controller-detached="true"]')).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Dock sidebar" }).click();
  await expect(page.locator('aside[data-controller-detached="false"]')).toBeVisible();

  // The wide-panel preference persists across reloads.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Wide panel" }).click();
  await expect(page.locator('aside[data-controller-wide="true"]')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sentio-sidebar-preferences-v1") ?? "{}").wide)).toBe(true);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator('aside[data-controller-wide="true"]')).toBeVisible();

  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await expect(page.getByRole("region", { name: "Full-width AI Lab workspace" })).toBeVisible();
  await expect(page.getByText("AI Lab · Live Game Analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("waiting for first move", { exact: true })).toBeVisible();
  await expect(page.getByText("WAITING FOR GAME", { exact: true })).toBeVisible();
  expect(await page.locator(".ai-lab-workspace-panel").evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Board", exact: true }).click();
  expect(await page.locator(".controller-content").evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  await page.locator("#sentio-engine-board-square-e2").click();
  await page.locator("#sentio-engine-board-square-e4").click();
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await expect(page.getByText("tracking live game", { exact: true })).toBeVisible();
  await expect(page.getByText(/LIVE TRACE|SEARCHING/, { exact: true })).toBeVisible();

  await expect(page.getByText("Minimax Flight Recorder", { exact: true })).toBeVisible();
  await expect(page.getByText("Position under analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("Search tree", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Search graph nodes")).toBeVisible();
  await expect(page.getByLabel("Graph node status")).toBeVisible();
  await expect(page.getByLabel("Graph node depth")).toBeVisible();
  await page.getByLabel("Search graph nodes").fill("e4");
  await expect(page.getByText(/matching nodes/)).toBeVisible();
  await chooseCustomOption(page.getByLabel("Graph node status"), "Principal");
  await expect(page.getByText(/matching nodes/)).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Search graph nodes")).toHaveValue("");
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
  await expect(page.getByLabel("3D graph navigation controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in graph" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pan graph left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset graph camera" })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in graph" }).click();
  await page.getByRole("button", { name: "Pan graph right" }).click();
  await page.getByRole("button", { name: "Reset graph camera" }).click();
  await expect(page.getByRole("button", { name: "Reset view" })).toBeVisible();
  const graphShell = await page.locator(".ai-graph-shell").boundingBox();
  const graphCard = await page.locator(".ai-lab-workspace-panel").boundingBox();
  expect(graphShell).not.toBeNull();
  expect(graphCard).not.toBeNull();
  expect(Math.abs((graphShell?.x ?? 0) + (graphShell?.width ?? 0) / 2 - ((graphCard?.x ?? 0) + (graphCard?.width ?? 0) / 2))).toBeLessThan(12);
  await expect(page.getByText("3D MCTS rollout graph", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await expect(page.getByText("Search Benchmarks", { exact: true })).toBeVisible();
  await expect(page.getByText("Depth scaling", { exact: true })).toBeVisible();
  await expect(page.getByText("Minimax avg", { exact: true })).toBeVisible();
  await expect(page.getByText("MCTS avg", { exact: true })).toBeVisible();
  await chooseCustomOption(page.getByRole("combobox", { name: "Metric" }), "Search throughput");

  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.getByText("3D Arena Active", { exact: false })).toBeVisible();
  await expect(page.locator("#replay-game-select")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay previous move" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay next move" })).toBeVisible();
});
