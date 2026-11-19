import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppStore, useApp } from "../src/store.ts";
import { editorActions } from "../src/Editor.tsx";
import { defaultSettings, resolveLink, relativeLink } from "../src/types.ts";
import {
  createRenderer,
  createTOC,
  prepareMarkdown,
  toggleTask,
} from "../src/markdown.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(t, overrides = {}) {
  const disk = new Map([
    ["A:a.md", "A"],
    ["B:a.md", "B"],
  ]);
  const versions = new Map();
  const saved = [];
  let persisted;
  const api = {
    isTauriRuntime: () => true,
    getAppInfo: async () => ({ name: "MarkFolio", version: "0.1.0" }),
    getSnapshot: async () => ({
      workspaces: ["A", "B"].map((id) => ({ id, name: id, available: true })),
      settings: {},
    }),
    openWorkspace: async () => ({ id: "A", name: "A", available: true }),
    listPlugins: async () => [],
    listDirectory: async () => [],
    rebuildIndex: async () => 0,
    saveSettings: async (settings) => {
      persisted = settings;
    },
    closeWorkspace: async () => {},
    readDocument: async (id, path) => {
      const key = `${id}:${path}`;
      if (!disk.has(key)) throw { code: "NOT_FOUND", message: "missing" };
      return {
        path,
        text: disk.get(key),
        encoding: "utf8",
        lineEnding: "lf",
        version: String(versions.get(key) ?? 0),
      };
    },
    saveDocument: async (id, doc) => {
      const key = `${id}:${doc.path}`;
      if (String(versions.get(key) ?? 0) !== doc.version)
        throw { code: "CONFLICT", message: "conflict" };
      disk.set(key, doc.text);
      versions.set(key, (versions.get(key) ?? 0) + 1);
      saved.push({ id, ...doc });
      return api.readDocument(id, doc.path);
    },
    ...overrides,
  };
  const store = createAppStore(api);
  t.after(() => store.getState().persistSettings());
  return { store, api, disk, versions, saved, settings: () => persisted };
}
test("fresh settings and concurrent initialization restore one independent session per directory", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    getSnapshot: async () => {
      calls++;
      return {
        workspaces: ["A", "B"].map((id) => ({ id, name: id, available: true })),
        settings: null,
      };
    },
  });
  await Promise.all([
    f.store.getState().initialize(),
    f.store.getState().initialize(),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(f.store.getState().order, ["A", "B"]);
  assert.equal(f.store.getState().settings.fontSize, defaultSettings.fontSize);
});
test("same filename editing and saving are bound to the original workspace after switching", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  await state.openDocument("B", "a.md");
  state.edit("A", "a.md", "only A");
  state.activate("B");
  await state.save("A", "a.md");
  assert.equal(f.disk.get("A:a.md"), "only A");
  assert.equal(f.disk.get("B:a.md"), "B");
  assert.equal(f.store.getState().sessions.B.documents["a.md"].text, "B");
});
test("a save that finishes after another edit keeps the newer buffer dirty and queues its version", async (t) => {
  const gate = deferred();
  const f = fixture(t);
  const original = f.api.saveDocument;
  let calls = 0;
  f.api.saveDocument = async (...args) => {
    if (++calls === 1) await gate.promise;
    return original(...args);
  };
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  state.edit("A", "a.md", "first");
  const first = state.save("A", "a.md");
  await Promise.resolve();
  await Promise.resolve();
  state.edit("A", "a.md", "second");
  const second = state.save("A", "a.md");
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(f.disk.get("A:a.md"), "second");
  assert.equal(calls, 2);
  assert.equal(f.store.getState().sessions.A.documents["a.md"].dirty, false);
});
test("external edits refresh a clean buffer but preserve a dirty buffer until conflict is resolved", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  f.disk.set("A:a.md", "external one");
  f.versions.set("A:a.md", 1);
  await state.refresh("A");
  assert.equal(
    f.store.getState().sessions.A.documents["a.md"].text,
    "external one",
  );
  state.edit("A", "a.md", "mine");
  f.disk.set("A:a.md", "external two");
  f.versions.set("A:a.md", 2);
  await state.refresh("A");
  assert.equal(f.store.getState().sessions.A.documents["a.md"].text, "mine");
  await assert.rejects(state.save("A", "a.md"));
  assert.equal(f.disk.get("A:a.md"), "external two");
});
test("a transient write failure can be retried with the original version", async (t) => {
  const f = fixture(t);
  const original = f.api.saveDocument;
  let fail = true;
  f.api.saveDocument = (...args) => {
    if (fail) {
      fail = false;
      return Promise.reject({ code: "IO", message: "temporarily unavailable" });
    }
    return original(...args);
  };
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  state.edit("A", "a.md", "retry");
  await assert.rejects(state.save("A", "a.md"));
  await state.save("A", "a.md");
  assert.equal(f.disk.get("A:a.md"), "retry");
});
test("late file reads cannot override a more recent document selection", async (t) => {
  const f = fixture(t);
  const original = f.api.readDocument;
  const gate = deferred();
  f.disk.set("A:slow.md", "slow");
  f.api.readDocument = async (id, path) => {
    if (path === "slow.md") await gate.promise;
    return original(id, path);
  };
  const state = f.store.getState();
  await state.initialize();
  const slow = state.openDocument("A", "slow.md");
  await state.openDocument("A", "a.md");
  gate.resolve();
  await slow;
  assert.equal(f.store.getState().sessions.A.file, "a.md");
});
test("closing a directory saves it and leaves another directory and its files intact", async (t) => {
  const f = fixture(t);
  const state = f.store.getState();
  await state.initialize();
  await state.openDocument("A", "a.md");
  state.edit("A", "a.md", "close saved");
  await state.closeWorkspace("A");
  await state.persistSettings();
  assert.equal(f.disk.get("A:a.md"), "close saved");
  assert.equal(f.disk.get("B:a.md"), "B");
  assert.deepEqual(f.store.getState().order, ["B"]);
  assert.equal(f.settings().sessions.A.file, "a.md");
  await state.openWorkspace();
  assert.equal(f.store.getState().sessions.A.file, "a.md");
});
test("relative attachments resolve within a directory and reject escape or URL schemes", () => {
  assert.equal(resolveLink("计划/a.md", "../图片/a%20b.png"), "图片/a b.png");
  for (const path of [
    "../../private",
    "file:///secret",
    "https://example.com/a.png",
    "/secret",
  ])
    assert.equal(resolveLink("计划/a.md", path), null);
  assert.equal(
    relativeLink("计划/a.md", "图片/a b.png"),
    "../%E5%9B%BE%E7%89%87/a%20b.png",
  );
});
test("Markdown images have no fetchable src before insertion and headings share TOC anchors", () => {
  const text =
    "# 中文标题\n\n## 标题\n\n## 标题\n\n```md\n# not a heading\n```\n\n![remote](https://example.com/a.png)";
  const html = createRenderer().render(text);
  assert.match(html, /id="中文标题"/);
  assert.match(html, /id="标题-1"/);
  assert.match(html, /data-local-src="https:/);
  assert.ok(!/<img[^>]*\ssrc=/.test(html));
  const toc = createTOC(text);
  assert.match(toc, /#标题-1/);
  assert.ok(!toc.includes("not a heading"));
});
test("preview task clicks use original source line numbers including front matter", () => {
  const source = "---\nunknown: keep\n---\n\n- [ ] 第一项\n- [x] 第二项\n";
  const html = createRenderer().render(prepareMarkdown(source));
  assert.match(html, /data-task-line="4"/);
  assert.equal(
    toggleTask(source, 4, true),
    source.replace("- [ ] 第一项", "- [x] 第一项"),
  );
});

test("format insertion and undo work when a document starts in preview mode", (t) => {
  const original = useApp.getState();
  const workspace = "preview-test";
  const text = "# Preview";
  useApp.setState({
    sessions: {
      [workspace]: {
        file: "a.md",
        documents: {
          "a.md": {
            path: "a.md",
            text,
            savedText: text,
            dirty: false,
            revision: 0,
          },
        },
      },
    },
  });
  t.after(() => {
    editorActions.clear(workspace);
    useApp.setState(original);
  });
  editorActions.insert(workspace, "new");
  assert.equal(
    useApp.getState().sessions[workspace].documents["a.md"].text,
    "new# Preview",
  );
  editorActions.undo(workspace);
  assert.equal(
    useApp.getState().sessions[workspace].documents["a.md"].text,
    text,
  );
  editorActions.redo(workspace);
  assert.equal(
    useApp.getState().sessions[workspace].documents["a.md"].text,
    "new# Preview",
  );
});
