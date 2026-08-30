import { expect, test } from "@playwright/test";

// Regression tests for the custom Select component: the trigger must display
// the selected label (not "Select..."), the portaled menu must stay inside the
// viewport and remain clickable above the chessboard, and the page must not
// overflow horizontally on small screens.
test.describe("custom select smoke", () => {
  test("trigger shows the selected label and the menu stays in view", async ({ page }) => {
    await page.goto("/?e2e=1");
    await page.waitForLoadState("domcontentloaded");

    const emotionTrigger = page.locator("header").getByRole("combobox").first();
    await expect(emotionTrigger).toBeVisible();

    // Before any interaction the controlled value already has a label —
    // the trigger must show it, not "Select...".
    const initialText = (await emotionTrigger.innerText()).trim();
    expect(initialText).not.toBe("Select...");
    expect(initialText.length).toBeGreaterThan(0);

    // Open, pick a different option, and confirm the trigger updates.
    await emotionTrigger.click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();

    // Menu must be fully inside the viewport.
    const box = (await options.first().locator("..").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);

    await page.getByRole("option", { name: "Manual" }).click();
    await expect(emotionTrigger).toContainText("Manual");
    await expect(page.getByRole("option")).toHaveCount(0);

    // Second combobox (emotion) unlocks in manual mode — pick "Focused".
    const emotionSelect = page.locator("header").getByRole("combobox").nth(1);
    await emotionSelect.click();
    await page.getByRole("option", { name: "Focused" }).click();
    await expect(emotionSelect).toContainText("Focused");
    await expect(page.getByRole("option")).toHaveCount(0);
  });

  test("no horizontal overflow at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?e2e=1");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
