import { test } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "../src/store.ts";
import {
  builtinPlugins,
  synchronizePlugins,
  disposePlugins,
  useRegistry,
} from "../src/plugins/runtime.ts";

test("closing workspaces cancels pending plugin registrations immediately and disposes late results", async (t) => {
  const original = useApp.getState();
  let resolve;
  const gate = new Promise((done) => {
    resolve = done;
  });
  let cleanup = 0;
  const definition = {
    manifest: {
      id: "async-example",
      name: "Example",
      version: "1.0.0",
      description: "Test",
      sdkVersion: 1,
    },
    async load(context) {
      context.addCommand({ id: "early", name: "Early", run() {} });
      await gate;
      context.addCommand({ id: "late", name: "Late", run() {} });
      return () => {
        cleanup++;
      };
    },
  };
  builtinPlugins.push(definition);
  const sessions = Object.fromEntries(
    ["A", "B"].map((id) => [id, { info: { id, name: id, available: true } }]),
  );
  useApp.setState({ sessions, order: ["A", "B"], active: "A" });
  t.after(() => {
    disposePlugins();
    builtinPlugins.splice(builtinPlugins.indexOf(definition), 1);
    useApp.setState(original);
  });
  synchronizePlugins();
  await new Promise((done) => setImmediate(done));
  const commands = useRegistry
    .getState()
    .commands.filter((command) => command.plugin === "async-example");
  assert.equal(commands.length, 2);
  assert.deepEqual(commands.map((command) => command.workspace).sort(), [
    "A",
    "B",
  ]);
  useApp.setState({ sessions: {}, order: [], active: "" });
  synchronizePlugins();
  assert.equal(useRegistry.getState().commands.length, 0);
  assert.equal(useRegistry.getState().panels.length, 0);
  resolve();
  await new Promise((done) => setImmediate(done));
  assert.equal(useRegistry.getState().commands.length, 0);
  assert.equal(cleanup, 2);
});
