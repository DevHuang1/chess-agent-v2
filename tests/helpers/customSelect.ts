import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The app uses a custom (non-native) Select component, so Playwright's
 * selectOption() does not apply. Click the trigger, pick the option by its
 * visible label, and verify the trigger now displays the selected label.
 */
export async function chooseCustomOption(trigger: Locator, optionText: string) {
  const page: Page = trigger.page();
  await trigger.click();
  const option = page.getByRole("option", { name: optionText });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByRole("option", { name: optionText })).toHaveCount(0);
  await expect(trigger).toContainText(optionText);
}
