import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/ui/fixture.html");
  await expect(page.getByRole("tablist", { name: "工作目录页签" })).toBeVisible();
});

test("文件页签右键提供相对路径、完整路径与资源管理器定位", async ({ page }) => {
  await page.locator(".file-tab").first().click({ button: "right" });
  const menu = page.locator(".file-tab-menu");
  await expect(menu.getByRole("menuitem", { name: "复制相对路径", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "复制完整路径", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "在资源管理器中定位", exact: true })).toBeVisible();
});

test("工作目录页签右键可在资源管理器中打开目录", async ({ page }) => {
  await page.locator(".workspace-tab").first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "在资源管理器中打开目录", exact: true })).toBeVisible();
});

test("文档列表右键提供复制菜单，移动对话框使用目录选择器", async ({ page }) => {
  await page.locator(".document-card").first().click({ button: "right" });
  const menu = page.locator(".document-menu");
  for (const label of ["复制名称", "复制相对路径", "复制完整路径", "在资源管理器中定位", "移入回收站"]) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  await menu.getByRole("menuitem", { name: "移动到…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文档操作", exact: true });
  await expect(dialog.getByRole("heading", { name: "移动选中文件", exact: true })).toBeVisible();
  await expect(dialog.locator(".directory-picker")).toBeVisible();
  await expect(dialog.locator(".directory-row.root")).toContainText("我的笔记");
  await expect(dialog.locator(".text-input")).toHaveCount(0);
});

test("中间栏与文档标题区保持紧凑", async ({ page }) => {
  const heights = await page.evaluate(() => {
    const height = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    return {
      navigation: height(".document-navigation"),
      title: height(".document-title"),
      listHeading: height(".list-heading"),
      paneLabel: height(".pane-label"),
    };
  });
  expect(heights.navigation).toBeLessThanOrEqual(36);
  expect(heights.title).toBeLessThanOrEqual(80);
  expect(heights.listHeading).toBeLessThanOrEqual(60);
  expect(heights.paneLabel).toBeLessThanOrEqual(20);
});

async function addFolder(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const { useApp } = await import("/src/store.ts");
    const state = useApp.getState();
    const session = state.sessions.notes;
    useApp.setState({
      sessions: {
        ...state.sessions,
        notes: {
          ...session,
          tree: {
            ...session.tree,
            "": [...(session.tree[""] ?? []), { name: "folder", path: "folder", isDirectory: true, size: 0, modified: Date.now() }],
            folder: [],
          },
        },
      },
    });
  });
}

test("第二栏空白右键提供新建笔记", async ({ page }) => {
  const list = await page.locator(".file-list-scroll").boundingBox();
  expect(list).not.toBeNull();
  await page.mouse.click(list!.x + 20, list!.y + list!.height - 20, { button: "right" });
  await expect(page.getByRole("menuitem", { name: "新建笔记", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "在资源管理器中打开", exact: true })).toBeVisible();
});

test("第三栏不再显示 MARKDOWN 标签", async ({ page }) => {
  await expect(page.locator(".file-type")).toHaveCount(0);
  await expect(page.locator(".document-title")).not.toContainText("MARKDOWN");
});

test("第二栏标题与数量同一行、排序靠右，且不再显示选择栏", async ({ page }) => {
  const title = await page.locator(".list-heading h2").boundingBox();
  const count = await page.locator(".list-heading span").boundingBox();
  expect(title).not.toBeNull();
  expect(count).not.toBeNull();
  expect(Math.abs((title!.y + title!.height / 2) - (count!.y + count!.height / 2))).toBeLessThanOrEqual(6);
  expect(await page.locator(".sort-bar").evaluate((element) => getComputedStyle(element).justifyContent)).toBe("flex-end");
  await expect(page.getByRole("button", { name: "反转", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "详细", exact: true })).toBeVisible();
  await page.locator(".sort-trigger").click();
  await expect(page.getByRole("menuitemradio", { name: "修改时间", exact: true })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "修改时间", exact: true }).click();
  await expect(page.locator(".sort-trigger")).toContainText("修改时间");
  await page.locator(".sort-trigger").click();
  await page.getByRole("menuitemradio", { name: "名称", exact: true }).click();
  await page.locator(".document-card").first().click({ modifiers: ["Control"] });
  await expect(page.locator(".selection-bar")).toHaveCount(0);
});

test("第一栏笔记右键与第二栏菜单一致", async ({ page }) => {
  await page.getByRole("treeitem", { name: /开始使用\.md/ }).click({ button: "right" });
  const menu = page.locator(".context-menu");
  for (const label of ["复制笔记", "移动到…", "在资源管理器中定位", "复制名称", "复制相对路径", "复制完整路径", "文档属性", "复制笔记链接", "全选文件", "移入回收站"]) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  const colors = await menu.evaluate((element) => ["全选文件", "移入回收站"].map((label) => {
    const item = [...element.querySelectorAll('[role="menuitem"]')].find((button) => button.textContent?.includes(label));
    return item ? getComputedStyle(item).color : "";
  }));
  expect(colors[0]).toBe(colors[1]);
});

test("第一栏目录与空白右键提供新建/复制/打开目录", async ({ page }) => {
  await addFolder(page);
  await page.getByRole("treeitem", { name: "folder" }).click({ button: "right" });
  const menu = page.locator(".context-menu");
  for (const label of ["新建笔记", "新建目录", "复制相对路径", "复制完整路径", "在资源管理器中打开"]) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  const tree = await page.locator(".tree-scroll").boundingBox();
  expect(tree).not.toBeNull();
  await page.mouse.click(tree!.x + 30, tree!.y + tree!.height - 20, { button: "right" });
  const blank = page.locator(".context-menu");
  for (const label of ["新建目录", "新建笔记", "在资源管理器中打开"]) {
    await expect(blank.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
});

test("菜单打开时右键另一个目录直接切换菜单", async ({ page }) => {
  await addFolder(page);
  await page.getByRole("treeitem", { name: /开始使用\.md/ }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "复制笔记", exact: true })).toBeVisible();
  await page.getByRole("treeitem", { name: "folder" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "新建目录", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "复制笔记", exact: true })).toHaveCount(0);
});

test("第一栏顶部可切换第二栏，且不再显示新建文件夹按钮", async ({ page }) => {
  const header = page.locator(".sidebar-heading");
  await expect(header).toContainText("我的笔记");
  await expect(header).not.toContainText("文件");
  await expect(header.getByRole("button", { name: "新建文件夹", exact: true })).toHaveCount(0);
  await expect(page.locator(".tree-root")).toHaveCount(0);
  await expect(page.getByText("本地工作目录", { exact: true })).toHaveCount(0);
  const toggle = header.getByRole("button", { name: "显示 / 隐藏文件列表", exact: true });
  await expect(toggle).toBeVisible();
  await expect(page.locator(".file-list")).toHaveCount(1);
  await toggle.click();
  await expect(page.locator(".file-list")).toHaveCount(0);
  await toggle.click();
  await expect(page.locator(".file-list")).toHaveCount(1);
});

test("暗色主题下文档标题与列表标题使用正文色", async ({ page }) => {
  await page.evaluate(async () => { const { useApp } = await import("/src/store.ts"); useApp.getState().updateSettings({ theme: "dark" }); });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const expected = "rgb(219, 226, 237)";
  expect(await page.locator(".document-title h1").evaluate((element) => getComputedStyle(element).color)).toBe(expected);
  expect(await page.locator(".list-heading h2").evaluate((element) => getComputedStyle(element).color)).toBe(expected);
});

test("第一栏点击目录行切换展开状态", async ({ page }) => {
  await addFolder(page);
  const folder = page.getByRole("treeitem", { name: "folder" });
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
});
