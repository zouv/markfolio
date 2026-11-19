import { expect, type Page } from "@playwright/test";

export async function openSettings(page: Page, english = false) {
  const trigger = english ? "App menu" : "应用菜单";
  await page.getByRole("button", { name: trigger }).click();
  const menu = page.getByRole("menu", { name: trigger });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: english ? "Settings" : "设置" }).click();
  await expect(page.getByRole("dialog", { name: english ? "Settings" : "设置", exact: true })).toBeVisible();
}
