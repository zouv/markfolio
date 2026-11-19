import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("UI runtime:", error.message));
  await page.goto("/tests/ui/fixture.html");
  await expect(page.getByRole("tablist", { name: "工作目录页签" })).toBeVisible();
});

test("工作目录页签位于标题栏，文件页签栏位于列表与编辑器顶部", async ({ page }) => {
  const titleBar = page.locator(".title-bar");
  const workspaceTabs = page.getByRole("tablist", { name: "工作目录页签" });
  const fileTabs = page.getByRole("tablist", { name: "文件页签" });
  const sidebar = page.locator(".sidebar");
  const list = page.locator(".file-list");

  await expect(workspaceTabs.getByRole("tab")).toHaveCount(2);
  await expect(fileTabs.getByRole("tab")).toHaveCount(3);
  await expect(titleBar.getByRole("tablist", { name: "工作目录页签" })).toBeVisible();

  const bar = await titleBar.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  const fileTabsBox = await fileTabs.boundingBox();
  const listBox = await list.boundingBox();
  expect(bar && sidebarBox && fileTabsBox && listBox).toBeTruthy();
  expect(fileTabsBox!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  expect(fileTabsBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width - 1);
  expect(fileTabsBox!.y).toBeLessThanOrEqual(listBox!.y + 1);
});

test("工作目录页签可拖动排序", async ({ page }) => {
  const tabs = page.getByRole("tablist", { name: "工作目录页签" }).getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await tabs.filter({ hasText: "工作文档" }).dragTo(tabs.filter({ hasText: "我的笔记" }), { targetPosition: { x: 5, y: 15 } });
  await expect(tabs.nth(0)).toContainText("工作文档");
  await expect(tabs.nth(1)).toContainText("我的笔记");
});

test("文件页签可切换与关闭，关闭后选择邻近页签", async ({ page }) => {
  const fileTabs = page.getByRole("tablist", { name: "文件页签" }).getByRole("tab");
  const second = fileTabs.filter({ hasText: "第二篇" });
  await second.click();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".document-title h1")).toHaveText("第二篇");

  await second.hover();
  await second.getByRole("button", { name: /关闭文档页签/ }).click();
  await expect(fileTabs).toHaveCount(2);
  await expect(page.locator(".document-title h1")).not.toHaveText("第二篇");
});

test("Ctrl+P 实时搜索跨工作目录笔记并打开选中结果", async ({ page }) => {
  await page.keyboard.press("Control+P");
  const dialog = page.getByRole("dialog", { name: "快速搜索" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox", { name: "快速搜索" });
  await input.fill("第二");
  const results = dialog.getByRole("option");
  await expect(results).toHaveCount(2);
  await expect(dialog.getByText("[我的笔记]", { exact: true })).toBeVisible();
  await expect(dialog.getByText("[工作文档]", { exact: true })).toBeVisible();
  await expect(dialog.locator("mark.quick-hit").first()).toHaveText("第二");

  await results.filter({ hasText: "[工作文档]" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: /工作文档/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".document-title h1")).toHaveText("第二篇");
  await expect(page.getByRole("tablist", { name: "文件页签" }).getByRole("tab").filter({ hasText: "第二篇" })).toHaveAttribute("aria-selected", "true");
});

test("快速搜索输入时即时过滤、高亮并支持空结果", async ({ page }) => {
  await page.keyboard.press("Control+P");
  const dialog = page.getByRole("dialog", { name: "快速搜索" });
  const input = dialog.getByRole("textbox", { name: "快速搜索" });
  await input.fill("第三");
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(dialog.locator("mark.quick-hit").first()).toHaveText("第三");
  await input.fill("不存在的笔记");
  await expect(dialog.getByText("没有匹配的笔记")).toBeVisible();
  await input.press("Escape");
  await expect(dialog).toBeHidden();
});

test("应用图标菜单可打开关于对话框并恢复焦点", async ({ page }) => {
  await page.getByRole("button", { name: "应用菜单" }).click();
  const menu = page.getByRole("menu", { name: "应用菜单" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: /关于 MarkFolio/ }).click();
  const dialog = page.getByRole("dialog", { name: "关于 MarkFolio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img.about-app-icon")).toHaveAttribute("src", /markfolio-icon\.png/);
  await expect(dialog.getByText("本地 Markdown 文档管理工具，直接编辑工作目录中的原文件。")).toBeVisible();
  await expect(dialog.getByText("基于 Tauri 2、Rust 与 React 构建。")).toBeVisible();
  await expect(dialog.getByText("作者 @zouv")).toBeVisible();
  const close = dialog.locator(".about-footer").getByRole("button", { name: "关闭", exact: true });
  await expect(close).toBeFocused();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "应用菜单" })).toBeFocused();
});

test("关于对话框支持 Escape、遮罩关闭与焦点循环", async ({ page }) => {
  const openAbout = async () => {
    await page.getByRole("button", { name: "应用菜单" }).click();
    await page.getByRole("menu", { name: "应用菜单" }).getByRole("menuitem", { name: /关于 MarkFolio/ }).click();
    const dialog = page.getByRole("dialog", { name: "关于 MarkFolio" });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  let dialog = await openAbout();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "应用菜单" })).toBeFocused();

  dialog = await openAbout();
  const close = dialog.locator(".about-footer").getByRole("button", { name: "关闭", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(".about-close")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});
