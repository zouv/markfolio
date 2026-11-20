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
  await menu.getByRole("menuitem", { name: /^关于/ }).click();
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

test("应用菜单无品牌标题，提供最近打开子菜单与 Alt+F4 提示", async ({ page }) => {
  await page.getByRole("button", { name: "应用菜单" }).click();
  const menu = page.getByRole("menu", { name: "应用菜单" });
  await expect(menu.locator(".app-menu-heading")).toHaveCount(0);
  const quit = menu.getByRole("menuitem", { name: /退出/ });
  await expect(quit.locator("kbd")).toHaveText("Alt+F4");
  await expect(quit).not.toHaveClass(/app-menu-danger/);
  await menu.getByRole("menuitem", { name: "打开最近" }).click();
  const recent = page.getByRole("menu", { name: "最近打开的工作目录" });
  await expect(recent).toBeVisible();
  await expect(recent.getByText("暂无最近打开的工作目录")).toBeVisible();
});

test("菜单栏位于应用图标与工作目录页签之间并可展开命令", async ({ page }) => {
  const bar = page.getByRole("menubar", { name: "菜单栏" });
  await expect(bar).toBeVisible();
  const appButton = await page.getByRole("button", { name: "应用菜单" }).boundingBox();
  const barBox = await bar.boundingBox();
  const tabsBox = await page.getByRole("tablist", { name: "工作目录页签" }).boundingBox();
  expect(appButton && barBox && tabsBox).toBeTruthy();
  expect(barBox!.x).toBeGreaterThanOrEqual(appButton!.x + appButton!.width - 1);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(tabsBox!.x + 1);

  await bar.getByRole("menuitem", { name: "视图" }).click();
  const menu = page.getByRole("menu", { name: "视图" });
  await expect(menu).toBeVisible();
  const toggle = menu.getByRole("menuitem", { name: "显示 / 隐藏侧栏" });
  await expect(toggle.locator(".menu-check svg")).toHaveCount(1);
  await toggle.click();
  await expect(page.locator(".sidebar")).toHaveCount(0);

  await bar.getByRole("menuitem", { name: "视图" }).click();
  await expect(menu).toBeVisible();
  await expect(toggle.locator(".menu-check svg")).toHaveCount(0);
  await toggle.click();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("左右两个宽度手柄分别调整侧栏与文件栏宽度", async ({ page }) => {
  const sidebar = page.locator(".sidebar");
  const list = page.locator(".file-list");
  const drag = async (handle: ReturnType<typeof page.locator>, delta: number) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  const beforeSidebar = (await sidebar.boundingBox())!.width;
  const beforeList = (await list.boundingBox())!.width;
  await drag(page.locator(".resize-handle").nth(0), 60);
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(beforeSidebar + 40);
  expect(Math.abs((await list.boundingBox())!.width - beforeList)).toBeLessThan(2);
  const beforeListSecond = (await list.boundingBox())!.width;
  const beforeSidebarSecond = (await sidebar.boundingBox())!.width;
  await drag(page.locator(".resize-handle").nth(1), 40);
  expect((await list.boundingBox())!.width).toBeGreaterThan(beforeListSecond + 25);
  expect(Math.abs((await sidebar.boundingBox())!.width - beforeSidebarSecond)).toBeLessThan(2);
});

test("桌面设置提供“关闭窗口时最小化到托盘”且默认不勾选", async ({ page }) => {
  await page.getByRole("button", { name: "应用菜单" }).click();
  await page.getByRole("menu", { name: "应用菜单" }).getByRole("menuitem", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "桌面" }).click();
  const row = dialog.locator('[data-setting="minimizeToTray"]');
  await expect(row).toContainText("关闭窗口时最小化到托盘");
  await expect(row.getByRole("checkbox")).not.toBeChecked();
});

test("关于对话框支持 Escape、遮罩关闭与焦点循环", async ({ page }) => {
  const openAbout = async () => {
    await page.getByRole("button", { name: "应用菜单" }).click();
    await page.getByRole("menu", { name: "应用菜单" }).getByRole("menuitem", { name: /^关于/ }).click();
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
