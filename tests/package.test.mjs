import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInstallerForVersion, publishPackageSet } from "../scripts/package-lib.mjs";

test("installer collection excludes previous versions and prereleases from the release package", () => {
  for (const name of [
    "MarkFolio_0.1.1_x64_en-US.msi",
    "MarkFolio_0.1.1_x64-setup.exe",
    "markfolio_0.1.1_amd64.deb",
    "MarkFolio_0.1.1_aarch64.dmg",
    "MarkFolio_0.1.1_amd64.AppImage",
    "markfolio-0.1.1-1.x86_64.rpm",
  ]) assert.equal(isInstallerForVersion(name, "0.1.1"), true, name);
  for (const name of [
    "MarkFolio_0.1.0_x64_en-US.msi",
    "MarkFolio_0.1.10_x64-setup.exe",
    "MarkFolio_0.1.1-beta_x64-setup.exe",
    "MarkFolio_0.1.1_x64.txt",
    "setup.exe",
  ]) assert.equal(isInstallerForVersion(name, "0.1.1"), false, name);
  assert.equal(isInstallerForVersion("MarkFolio_0.1.1-beta_x64-setup.exe", "0.1.1-beta"), true);
});

test("a failed release promotion restores both previously published packages", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "markfolio-package-test-"),
  );
  const stage = path.join(root, "stage"),
    dist = path.join(root, "dist");
  for (const base of [stage, dist])
    for (const name of ["dev", "release"]) {
      fs.mkdirSync(path.join(base, name), { recursive: true });
      fs.writeFileSync(
        path.join(base, name, "marker"),
        base === stage ? "new" : "old",
      );
    }
  const original = fs.renameSync;
  let failed = false;
  fs.renameSync = (from, to) => {
    if (
      !failed &&
      from === path.join(stage, "release") &&
      to === path.join(dist, "release")
    ) {
      failed = true;
      throw Object.assign(new Error("promotion failure"), { code: "EIO" });
    }
    return original(from, to);
  };
  try {
    assert.throws(
      () => publishPackageSet(root, stage, dist),
      /promotion failure/,
    );
    for (const name of ["dev", "release"]) {
      assert.equal(
        fs.readFileSync(path.join(dist, name, "marker"), "utf8"),
        "old",
      );
      assert.equal(
        fs.readFileSync(path.join(stage, name, "marker"), "utf8"),
        "new",
      );
    }
  } finally {
    fs.renameSync = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("package promotion refuses a directory outside the workspace", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "markfolio-package-scope-"),
  );
  try {
    assert.throws(
      () =>
        publishPackageSet(root, path.join(root, "stage"), path.dirname(root)),
      /escapes workspace/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "Windows native fallback preserves complete packages when Node directory rename is refused",
  { skip: process.platform !== "win32" },
  () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "markfolio-package-fallback-"),
    );
    const stage = path.join(root, "stage"),
      dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    for (const name of ["dev", "release"]) {
      fs.mkdirSync(path.join(stage, name), { recursive: true });
      fs.writeFileSync(path.join(stage, name, "marker"), "complete");
    }
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (from === path.join(stage, "release"))
        throw Object.assign(new Error("Windows rename refusal"), {
          code: "EPERM",
        });
      return original(from, to);
    };
    try {
      publishPackageSet(root, stage, dist);
      for (const name of ["dev", "release"])
        assert.equal(
          fs.readFileSync(path.join(dist, name, "marker"), "utf8"),
          "complete",
        );
    } finally {
      fs.renameSync = original;
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
