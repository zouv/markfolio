#!/usr/bin/env node
// Package desktop-tauri-react into dist/dev + dist/release (no third-party dependencies).
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireLock, copyDir, copyFile, ensureDir, isInstallerForVersion, listFiles, platformTag,
  publishPackageSet, releaseLock, writeChecksums, writeManifest, writeText, writeZip,
} from './package-lib.mjs';
import { guardRunningApp } from './process-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function getArg(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index + 1 >= args.length) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}
const pm = getArg('--pm') ?? 'npm';
if (!['npm', 'pnpm', 'yarn'].includes(pm)) throw new Error(`Unsupported package manager: ${pm}`);
const skipBuild = args.includes('--skip-build');
const unknown = args.filter((arg, index) => !['--pm', '--skip-build'].includes(arg) && !(index > 0 && args[index - 1] === '--pm'));
if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`);

function readText(file) { return fs.readFileSync(file, 'utf8'); }
function tryExec(file, argv) {
  try { return execFileSync(file, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unknown'; }
}

const tauriConf = JSON.parse(readText(path.join(root, 'src-tauri/tauri.conf.json')));
const product = tauriConf.productName;
if (!product) throw new Error('tauri.conf.json is missing productName');
const cargo = readText(path.join(root, 'src-tauri/Cargo.toml'));
const packageSection = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] ?? '';
const bin = /^\s*name\s*=\s*"([^"]+)"/m.exec(packageSection)?.[1];
const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(packageSection)?.[1];
if (!bin || !version) throw new Error('Cannot read package name/version from src-tauri/Cargo.toml');

const platform = platformTag();
const exe = process.platform === 'win32' ? '.exe' : '';
const dist = path.join(root, 'dist');
const stagingRoot = path.join(root, '.runtime', 'staging');
const stage = path.join(stagingRoot, `package-${Date.now()}-${process.pid}`);
const devDir = path.join(stage, 'dev');
const releaseDir = path.join(stage, 'release');
const devFolder = `${product}_${version}_${platform}-unpack-debug`;
const devSource = path.join(stage, 'source', devFolder);
const releaseUnpack = path.join(releaseDir, 'unpack');
const devZip = path.join(devDir, `${devFolder}.zip`);
const releaseZip = path.join(releaseDir, `${product}_${version}_${platform}-unpack.zip`);
const lockPath = path.join(root, '.runtime', 'package.lock');

function runPm(script) {
  execSync(`${pm} run ${script}`, { cwd: root, stdio: 'inherit', shell: true });
}

function findMacApp(configuration) {
  const dir = path.join(root, 'src-tauri', 'target', configuration, 'bundle', 'macos');
  if (!fs.existsSync(dir)) return null;
  const apps = fs.readdirSync(dir).filter((name) => name.endsWith('.app'));
  return apps.length > 0 ? path.join(dir, apps[0]) : null;
}

function copyRunnable(configuration, destination) {
  ensureDir(destination);
  if (process.platform === 'darwin') {
    const app = findMacApp(configuration);
    if (app) {
      copyDir(app, path.join(destination, path.basename(app)));
      return;
    }
  }
  const binary = path.join(root, 'src-tauri', 'target', configuration, `${bin}${exe}`);
  if (!fs.existsSync(binary)) throw new Error(`Missing ${configuration} binary: ${binary}`);
  copyFile(binary, path.join(destination, path.basename(binary)));
}

function copyDocumentation(destination) {
  for (const name of ['README.md', 'CHANGELOG.md', 'ROADMAP.md']) copyFile(path.join(root, name), path.join(destination, name));
  for (const [source, target] of [['docs', 'docs'], ['browser-extension', 'browser-extension'], ['examples/plugins', 'examples/plugins'], ['public/third-party', 'third-party']]) {
    const directory = path.join(root, source);
    if (!fs.existsSync(directory)) throw new Error(`Missing distribution documentation: ${source}`);
    copyDir(directory, path.join(destination, target));
  }
}

function writeInfo(directory, mode) {
  const lines = [
    `Product: ${product}`,
    `Version: ${version}`,
    `Platform: ${platform}`,
    `Mode: ${mode}`,
    `Built: ${new Date().toISOString()}`,
    `Git: ${tryExec('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])}`,
    `Working tree: ${tryExec('git', ['-C', root, 'status', '--porcelain']) ? 'modified' : 'clean'}`,
    `Node: ${process.version}`,
    `Rust: ${tryExec('cargo', ['--version'])}`,
  ];
  writeText(path.join(directory, 'build-info.txt'), lines);
  const readme = mode === 'Debug'
    ? [
        `${product} ${version} (${platform}) - debug build`,
        '================================================',
        '',
        'Debug build for development and troubleshooting.',
        process.platform === 'darwin' ? `Run the .app bundle in this folder.` : `Run ${path.basename(bin + exe)} from a terminal.`,
        'See README.md for usage and platform prerequisites.',
      ]
    : [
        `${product} ${version} (${platform})`,
        '==================================',
        '',
        'Portable release. Run the app from this folder; no installer is required.',
        process.platform === 'win32' ? 'Requires Microsoft Edge WebView2 Runtime.' : 'Requires the platform libraries listed in docs/02.',
        '',
        'See README.md for usage.',
      ];
  writeText(path.join(directory, 'README.txt'), readme);
}

function collectInstallers() {
  const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
  if (!fs.existsSync(bundleRoot)) return [];
  return listFiles(bundleRoot).filter((file) => isInstallerForVersion(file, version));
}

// A running instance may lock the build output; list it and ask before force-closing.
try {
  if (!(await guardRunningApp({ mode: 'prompt' }))) process.exit(2);
} catch (error) {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
}

acquireLock(lockPath);
try {
  ensureDir(devSource);
  ensureDir(releaseUnpack);
  ensureDir(devDir);
  ensureDir(releaseDir);

  if (!skipBuild) {
    console.log('[1/5] tauri build (release)');
    runPm('desktop:build');
    console.log('[2/5] tauri build --debug');
    runPm('desktop:build:debug');
  } else {
    console.log('[1/5] build skipped (--skip-build)');
  }

  console.log('[3/5] collect debug and release artifacts');
  copyRunnable('debug', devSource);
  copyDocumentation(devSource);
  writeInfo(devSource, 'Debug');
  copyRunnable('release', releaseUnpack);
  copyDocumentation(releaseUnpack);
  writeInfo(releaseUnpack, 'Release');

  const installers = [];
  for (const source of collectInstallers()) {
    const destination = path.join(releaseDir, path.basename(source));
    if (fs.existsSync(destination)) throw new Error(`Duplicate installer name: ${path.basename(source)}`);
    copyFile(source, destination);
    installers.push(destination);
  }

  console.log('[4/5] manifest and zip');
  writeManifest(devSource, path.join(devSource, 'unpack-manifest.json'), {
    product, version, mode: 'Debug', platform,
  });
  writeManifest(releaseUnpack, path.join(releaseUnpack, 'unpack-manifest.json'), {
    product, version, mode: 'Release', platform,
  });
  writeZip(devSource, devZip, devFolder);
  writeZip(releaseUnpack, releaseZip, '');

  console.log('[5/5] checksums and publish');
  const artifacts = [
    { path: releaseZip, name: path.basename(releaseZip) },
    ...installers.map((file) => ({ path: file, name: path.basename(file) })),
    { path: devZip, name: path.basename(devZip) },
  ];
  writeChecksums(path.join(releaseDir, 'SHA256SUMS.txt'), artifacts);

  ensureDir(dist);
  publishPackageSet(root, stage, dist);
  fs.rmSync(stage, { recursive: true, force: true });

  console.log(`[SUCCESS] ${product} ${version} (${platform})`);
  console.log(`  dev     : ${path.join(dist, 'dev', path.basename(devZip))}`);
  console.log(`  unpack  : ${path.join(dist, 'release', 'unpack')}`);
  console.log(`  release : ${path.join(dist, 'release', path.basename(releaseZip))}`);
  console.log(`  sha256  : ${path.join(dist, 'release', 'SHA256SUMS.txt')}`);
} catch (error) {
  console.error(`[fail] Packaging failed; staging kept for inspection: ${stage}`);
  throw error;
} finally {
  releaseLock(lockPath);
}
