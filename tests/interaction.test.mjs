import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../src/store.ts";
import { operateFiles, operationRoots } from "../src/fileOperations.ts";
import { defaultSettings } from "../src/types.ts";
import { settingsDraftPatch } from "../src/settings.ts";
import { registerCommand, useRegistry } from "../src/plugins/runtime.ts";
import {
  normalizeShortcut,
  shortcutFromEvent,
  validateShortcuts,
} from "../src/shortcuts.ts";

function fixture(t, overrides = {}) {
  const disk = new Map([
    ["A:a.md", "A"],
    ["A:b.md", "B"],
    ["B:a.md", "other workspace"],
  ]);
  const writes = [];
  const api = {
    isTauriRuntime: () => true,
    getAppInfo: async () => ({ version: "test" }),
    listPlugins: async () => [],
    getSnapshot: async () => ({
      workspaces: ["A", "B"].map((id) => ({ id, name: id, available: true })),
      settings: {},
    }),
    listDirectory: async () => [],
    rebuildIndex: async () => 0,
    closeWorkspace: async () => {},
    saveSettings: async (settings) => {
      writes.push(structuredClone(settings));
    },
    readDocument: async (id, path) => {
      if (!disk.has(`${id}:${path}`))
        throw { code: "NOT_FOUND", message: "missing" };
      return {
        path,
        text: disk.get(`${id}:${path}`),
        version: "v",
        encoding: "utf8",
        lineEnding: "lf",
      };
    },
    saveDocument: async (id, document) => {
      disk.set(`${id}:${document.path}`, document.text);
      return api.readDocument(id, document.path);
    },
    renameEntry: async (id, from, to) => {
      if (disk.has(`${id}:${to}`))
        throw { code: "EXISTS", message: "target exists" };
      disk.set(`${id}:${to}`, disk.get(`${id}:${from}`));
      disk.delete(`${id}:${from}`);
    },
    deleteEntry: async (id, path) => {
      disk.delete(`${id}:${path}`);
    },
    duplicateEntry: async (id, path) => {
      const to = `${path}.copy.md`;
      disk.set(`${id}:${to}`, disk.get(`${id}:${path}`));
      return to;
    },
    ...overrides,
  };
  const store = createAppStore(api);
  t.after(() => store.getState().persistSettings());
  return { store, api, disk, writes };
}
test("shortcut normalization detects reserved keys, duplicate assignments and plugin conflicts", () => {
  assert.equal(normalizeShortcut("shift+CTRL+k"), "Ctrl+Shift+K");
  assert.equal(
    shortcutFromEvent({
      key: "ArrowLeft",
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
    }),
    "Alt+Left",
  );
  assert.match(validateShortcuts({ "file.new": "Ctrl+C" }), /系统操作/);
  assert.match(validateShortcuts({ "file.new": "Ctrl+O" }), /同时分配/);
  assert.match(
    validateShortcuts({}, [
      { id: "plugin.test", name: "test", shortcut: "Ctrl+S" },
    ]),
    /同时分配/,
  );
  assert.equal(validateShortcuts({ "file.save": "Ctrl+Shift+K" }), "");
  assert.equal(validateShortcuts({ "file.save": "" }), "");
  assert.throws(() => normalizeShortcut("A"), /避免影响输入/);
});
test("core command ids remain stable between registry, native menus and custom shortcuts", (t) => {
  const dispose = registerCommand({
    id: "app.palette",
    name: "命令面板",
    shortcut: "Ctrl+Shift+P",
    run() {},
  });
  t.after(dispose);
  const command = useRegistry
    .getState()
    .commands.find((item) => item.id === "app.palette");
  assert.ok(command);
  assert.equal(validateShortcuts({}, useRegistry.getState().commands), "");
});
test("draft patches preserve unrelated runtime state and merge only edited plugin fields", () => {
  const base = structuredClone(defaultSettings);
  base.plugins = {
    A: { p: { enabled: true, data: { selected: "a", count: 1 } } },
  };
  const draft = structuredClone(base);
  draft.theme = "dark";
  draft.plugins.A.p.data.selected = "b";
  const current = structuredClone(base);
  current.plugins.A.p.data.count = 8;
  current.sessions.B = { file: "other.md" };
  const patch = settingsDraftPatch(current, base, draft);
  assert.equal(patch.theme, "dark");
  assert.equal(patch.sessions, undefined);
  assert.deepEqual(patch.plugins.A.p.data, { selected: "b", count: 8 });
  assert.equal(patch.autoSave, undefined);
});
test("failed settings writes do not apply draft changes or discard the current settings", async (t) => {
  const f = fixture(t);
  await f.store.getState().initialize();
  const base = structuredClone(f.store.getState().settings);
  const draft = { ...base, theme: "dark" };
  f.api.saveSettings = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(
    f.store.getState().applySettings(base, draft),
    /disk full/,
  );
  assert.equal(f.store.getState().settings.theme, base.theme);
  f.api.saveSettings = async () => {};
});
test("applying settings preserves workspace selection and a concurrent plugin update", async (t) => {
  const f = fixture(t);
  await f.store.getState().initialize();
  const base = structuredClone(f.store.getState().settings);
  const draft = { ...base, fontSize: 20 };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const save = f.api.saveSettings;
  f.api.saveSettings = async (settings) => {
    await gate;
    return save(settings);
  };
  const pending = f.store.getState().applySettings(base, draft);
  await Promise.resolve();
  await Promise.resolve();
  f.store.getState().activate("B");
  f.store.getState().updateSettings({
    plugins: { B: { p: { enabled: true, data: { count: 5 } } } },
  });
  release();
  await pending;
  await f.store.getState().persistSettings();
  assert.equal(f.store.getState().settings.fontSize, 20);
  assert.equal(f.store.getState().settings.plugins.B.p.data.count, 5);
  assert.equal(f.writes.at(-1).activeWorkspace, "B");
  assert.equal(f.writes.at(-1).plugins.B.p.data.count, 5);
});
test("batch moves save source edits, preserve selection and leave other workspaces intact", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  await state.openDocument("A", "b.md");
  state.edit("A", "a.md", "edited source");
  state.selectFiles("A", ["a.md", "b.md"]);
  state.activate("B");
  const result = await operateFiles(
    "A",
    ["a.md", "b.md"],
    "move",
    "folder",
    f.store,
    f.api,
  );
  assert.equal(result.completed.length, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(f.disk.get("A:folder/a.md"), "edited source");
  assert.equal(f.disk.get("B:a.md"), "other workspace");
  assert.deepEqual(f.store.getState().sessions.A.selected, [
    "folder/a.md",
    "folder/b.md",
  ]);
  assert.equal(f.store.getState().sessions.A.file, "folder/b.md");
  assert.equal(f.store.getState().active, "B");
});
test("batch deletion reports partial failure and retains unsaved documents", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  await state.openDocument("A", "b.md");
  state.edit("A", "a.md", "unsaved");
  const result = await operateFiles(
    "A",
    ["a.md", "b.md"],
    "delete",
    "",
    f.store,
    f.api,
  );
  assert.deepEqual(
    result.completed.map((item) => item.from),
    ["b.md"],
  );
  assert.deepEqual(
    result.failed.map((item) => item.path),
    ["a.md"],
  );
  assert.equal(f.disk.get("A:a.md"), "A");
  assert.equal(f.disk.has("A:b.md"), false);
  assert.equal(f.store.getState().sessions.A.documents["a.md"].text, "unsaved");
  assert.equal(f.disk.get("B:a.md"), "other workspace");
});
test("duplicate saves the source first and failed moves do not change the buffer path", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  state.edit("A", "a.md", "new content");
  await operateFiles("A", ["a.md"], "duplicate", "", f.store, f.api);
  assert.equal(f.disk.get("A:a.md.copy.md"), "new content");
  f.disk.set("A:folder/a.md", "existing");
  const result = await operateFiles(
    "A",
    ["a.md"],
    "move",
    "folder",
    f.store,
    f.api,
  );
  assert.equal(result.failed.length, 1);
  assert.equal(f.disk.get("A:folder/a.md"), "existing");
  assert.equal(f.store.getState().sessions.A.file, "a.md");
  assert.equal(f.store.getState().sessions.A.mutating, false);
});
test("workspace close and edits are rejected while a file mutation is pending", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  let release;
  f.api.renameEntry = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = operateFiles("A", ["a.md"], "move", "folder", f.store, f.api);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(state.closeWorkspace("A"), /正在处理文件/);
  assert.throws(() => state.edit("A", "a.md", "race"), /正在处理文件/);
  release();
  await pending;
});
test("selecting a folder and its descendants processes only the folder", () => {
  assert.deepEqual(
    operationRoots(["notes/a.md", "notes", "notes/a.md", "other.md"]),
    ["notes", "other.md"],
  );
});
