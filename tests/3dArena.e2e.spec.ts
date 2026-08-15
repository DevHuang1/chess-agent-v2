import { expect, test } from "@playwright/test";

type SceneSnapshot = {
  fen: string;
  reactGamePosition: string;
  playerAnimating: boolean;
  robotAnimating: boolean;
  robotCaptureHidden: boolean;
  e2Position: [number, number, number] | null;
  e4Position: [number, number, number] | null;
  pieceCount: number;
  sceneChildren: number;
};

type Sentio3DDebug = {
  setPosition: (fen: string) => boolean;
  selectAndMove: (from: string, to: string) => boolean;
  startRobotMove: (from: string, to: string) => boolean;
  getSquareScreenCenter: (square: string) => { x: number; y: number };
  getSnapshot: () => SceneSnapshot;
};

declare global {
  interface Window {
    __sentio3dDebug?: Sentio3DDebug;
  }
}

async function enter3DArena(page: import("@playwright/test").Page) {
  await page.goto("/?e2e=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "3D Mode" }).click({ force: true });
  await expect(page.getByRole("button", { name: "Exit 3D" })).toBeVisible();
  await expect(page.getByText("3D Arena Active", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.locator("canvas").count()).toBeGreaterThan(0);
}

async function getDebug(page: import("@playwright/test").Page) {
  await expect.poll(async () => page.evaluate(() => Boolean(window.__sentio3dDebug))).toBe(true);
  return page.evaluateHandle(() => window.__sentio3dDebug as Sentio3DDebug);
}

async function snapshot(page: import("@playwright/test").Page): Promise<SceneSnapshot> {
  return page.evaluate(() => window.__sentio3dDebug!.getSnapshot());
}

test.describe("3D arena", () => {
  test("transitions to a rendered arena and exposes the upgraded visual scene", async ({ page }) => {
    await enter3DArena(page);

    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const initial = await snapshot(page);
    expect(initial.pieceCount).toBe(32);
    expect(initial.sceneChildren).toBeGreaterThan(50);

    await expect(page).toHaveScreenshot("3d-arena.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      mask: [page.locator("div.fixed.inset-0.z-50 video")],
      scale: "css",
    });
  });

  test("runs live MCTS on the 3D board at depth 6", async ({ page }) => {
    await enter3DArena(page);
    await page.locator("#live-ai-algorithm").selectOption("mcts");
    await page.locator("#live-ai-depth").fill("6");
    await expect(page.locator("#live-ai-depth")).toHaveValue("6");
    await expect.poll(async () => (await snapshot(page)).robotAnimating, { timeout: 15_000 }).toBe(true);
    await page.locator("#live-ai-algorithm").selectOption("off");
  });

  test("animates a legal player move and commits it to the live chess state", async ({ page }) => {
    await enter3DArena(page);
    await getDebug(page);
    const initial = await snapshot(page);

    const accepted = await page.evaluate(() => window.__sentio3dDebug!.selectAndMove("e2", "e4"));
    expect(accepted).toBe(true);
    await expect.poll(async () => (await snapshot(page)).playerAnimating).toBe(true);
    const during = await snapshot(page);
    expect(during.fen).toBe(initial.fen);
    await expect.poll(async () => (await snapshot(page)).playerAnimating).toBe(false, { timeout: 5_000 });

    const result = await snapshot(page);
    expect(result.fen).toContain("4P3");
    expect(result.reactGamePosition).toContain("4P3");
    expect(result.e2Position).toBeNull();
    expect(result.e4Position).not.toBeNull();
    expect(result.e4Position![2]).not.toBe(initial.e2Position![2]);
    expect(result.pieceCount).toBe(32);
  });

  test("moves a piece through the real pointer drag-and-drop release path", async ({ page }) => {
    await enter3DArena(page);
    await getDebug(page);
    const initial = await snapshot(page);
    const points = await page.evaluate(() => ({
      from: window.__sentio3dDebug!.getSquareScreenCenter("e2"),
      to: window.__sentio3dDebug!.getSquareScreenCenter("e4"),
    }));

    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => (await snapshot(page)).playerAnimating).toBe(true);
    await page.waitForTimeout(120);
    const during = await snapshot(page);
    expect(during.fen).not.toContain("4P3");
    expect(during.reactGamePosition).not.toContain("4P3");
    expect(during.e2Position).not.toBeNull();
    expect(during.e2Position![2]).not.toBe(initial.e2Position![2]);
    expect(during.e4Position).toBeNull();
    await expect.poll(async () => (await snapshot(page)).playerAnimating).toBe(false, { timeout: 5_000 });

    const result = await snapshot(page);
    expect(result.fen).toContain("4P3");
    expect(result.reactGamePosition).toContain("4P3");
    expect(result.e2Position).toBeNull();
    expect(result.e4Position).not.toBeNull();
    expect(result.e4Position![2]).not.toBe(initial.e2Position![2]);
  });

  test("controls live lighting intensity, presets, and shadows", async ({ page }) => {
    await enter3DArena(page);

    await expect(page.getByText("Scene lighting", { exact: true })).toBeVisible();
    const preset = page.locator("#lighting-preset");
    await expect(preset).toHaveValue("studio");
    await preset.selectOption("dramatic");
    await expect(preset).toHaveValue("dramatic");

    const intensity = page.locator("#lighting-intensity");
    await intensity.fill("1.25");
    await expect(intensity).toHaveValue("1.25");

    const shadows = page.locator("#lighting-shadows");
    await expect(shadows).toBeChecked();
    await shadows.uncheck();
    await expect(shadows).not.toBeChecked();
    await shadows.check();
    await expect(shadows).toBeChecked();

    const audio = page.locator("#mechanical-audio");
    await expect(audio).toBeChecked();
    await audio.uncheck();
    await expect(audio).not.toBeChecked();
    await audio.check();
    await expect(audio).toBeChecked();
  });

  test("hides a captured piece during robot choreography and restores the final board", async ({ page }) => {
    await enter3DArena(page);
    await getDebug(page);

    const accepted = await page.evaluate(() => {
      const debug = window.__sentio3dDebug!;
      const positionReady = debug.setPosition("4k3/8/8/3r4/8/8/8/3QK3 b - - 0 1");
      return positionReady && debug.startRobotMove("d5", "d1");
    });
    expect(accepted).toBe(true);

    await expect.poll(async () => (await snapshot(page)).robotAnimating).toBe(true);
    await expect.poll(async () => (await snapshot(page)).robotCaptureHidden).toBe(true, { timeout: 5_000 });
    await expect.poll(async () => (await snapshot(page)).robotAnimating).toBe(false, { timeout: 20_000 });

    const result = await snapshot(page);
    expect(result.fen).toContain("4k3/8/8/8/8/8/8/3rK3 w - -");
    expect(result.pieceCount).toBe(3);
  });
});
