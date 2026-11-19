import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error=>console.error("UI runtime:",error.message));
  await page.goto("/tests/ui/fixture.html");
});
test("Ctrl 多选、Shift 范围选择和工作目录切换保留各自状态", async ({
  page,
}) => {
  const options = page
    .getByRole("listbox", { name: "文档列表" })
    .getByRole("option");
  await expect(options).toHaveCount(3);
  await options.nth(1).click({ modifiers: ["Control"] });
  await expect(page.getByText("已选 2 项")).toBeVisible();
  await options.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByText("已选 2 项")).toBeVisible();
  await page.getByRole("tab", { name: /工作文档/ }).click();
  await expect(page.getByText("已选 1 项")).toBeVisible();
  await page.getByRole("tab", { name: /我的笔记/ }).click();
  await expect(page.getByText("已选 2 项")).toBeVisible();
});
test("设置草稿取消后不生效，应用后保留，关闭再打开读取已应用值", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "外观", exact: true }).click();
  await dialog.locator('[data-setting="theme"] select').selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "外观", exact: true }).click();
  await expect(dialog.locator('[data-setting="theme"] select')).toHaveValue(
    "light",
  );
  await dialog.locator('[data-setting="theme"] select').selectOption("dark");
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("搜索设置可定位选项，快捷键冲突会阻止应用，重置后恢复", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("textbox", { name: "搜索设置" }).fill("行号");
  await dialog.getByRole("button", { name: /显示行号/ }).click();
  await expect(dialog.locator('[data-setting="lineNumbers"]')).toBeVisible();
  await dialog.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  const input = dialog.getByRole("textbox", {
    name: "保存文档快捷键",
    exact: true,
  });
  await input.fill("Ctrl+O");
  await expect(
    dialog.getByRole("button", { name: "确定", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("同时分配");
  await input
    .locator("..")
    .getByRole("button", { name: "重置", exact: true })
    .click();
  await expect(input).toHaveValue("Ctrl+S");
  await expect(
    dialog.getByRole("button", { name: "确定", exact: true }),
  ).toBeEnabled();
});
test("自定义快捷键与命令面板一致，旧绑定不再触发对应应用命令", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "命令面板快捷键", exact: true })
    .fill("Ctrl+Shift+K");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByRole("textbox", { name: "搜索命令" })).toHaveCount(0);
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByRole("textbox", { name: "搜索命令" })).toBeVisible();
});
test("界面没有横向溢出，设置窗口底部操作始终可见", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "确定", exact: true }),
  ).toBeInViewport();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  await page.screenshot({ path: ".runtime/ui-results/settings.png" });
});
