// Collect locked dependency notices and unchanged sources for MPL/EPL components.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listFiles, writeZip } from './package-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const overrideRoot = path.join(root, 'licenses/overrides');
const output = path.join(root, 'public/third-party');
const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
if (!target) throw new Error('Cannot determine the Rust target for dependency notices');
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--locked', '--format-version', '1', '--filter-platform', target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (path.resolve(output) !== path.resolve(root, 'public', 'third-party')) throw new Error('Invalid notice output');
if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || !fs.realpathSync(output).toLowerCase().startsWith(fs.realpathSync(root).toLowerCase() + path.sep))) throw new Error('Notice output must stay inside the project');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'licenses'), { recursive: true });
fs.mkdirSync(path.join(output, 'sources'), { recursive: true });
const records = [];
const id = value => value.replace(/[^a-zA-Z0-9._-]/g, '_');
function repository(value) {
  return (typeof value === 'string' ? value : value?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
}
function licenseFiles(directory) {
  return listFiles(directory).filter(file => !path.relative(directory, file).split(path.sep).includes('node_modules') && /^(?:licen[sc]e|copying|notice|copyright|ofl)(?:[._-]|$)/i.test(path.basename(file)) && fs.statSync(file).size <= 2 * 1024 * 1024);
}
function add({ ecosystem, name, version, license, directory, source, repo, authors, additional = [], sources = false }) {
  if (!license || /UNLICENSED/i.test(license)) throw new Error(`Missing usable license metadata: ${name} ${version}`);
  const key = id(`${ecosystem}-${name}-${version}`);
  const destination = path.join(output, 'licenses', key);
  fs.mkdirSync(destination, { recursive: true });
  const copied = [];
  for (const file of licenseFiles(directory)) {
    const relative = path.relative(directory, file);
    const to = path.join(destination, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(file, to);
    copied.push(path.relative(output, to).replaceAll(path.sep, '/'));
  }
  for (const file of additional) {
    const from = path.isAbsolute(file) ? file : path.join(overrideRoot, file);
    const to = path.join(destination, 'upstream-' + path.basename(from));
    fs.copyFileSync(from, to); copied.push(path.relative(output, to).replaceAll(path.sep, '/'));
  }
  if (!copied.length) throw new Error(`No license text collected: ${name} ${version}`);
  let sourceArchive;
  if (sources) {
    sourceArchive = `sources/${key}.zip`;
    writeZip(directory, path.join(output, sourceArchive), `${name}-${version}`);
  }
  records.push({ ecosystem, name, version, license, source, repository: repo, authors, licenseFiles: copied, ...(sourceArchive ? { sourceArchive } : {}) });
}

for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative.startsWith('node_modules/') || entry.dev || !fs.existsSync(path.join(root, relative))) continue;
  const directory = path.join(root, relative), pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const additional = [];
  if (pkg.name === 'tr46') additional.push('MIT-tr46.txt');
  if (pkg.name.startsWith('@napi-rs/canvas-')) additional.push(path.join(root, 'node_modules/@napi-rs/canvas/LICENSE'));
  if (pkg.name.startsWith('@tesseract.js-data/')) additional.push('MIT-standard.txt', 'Apache-2.0-tessdata.txt');
  if (pkg.name === 'katex') additional.push('MIT-katex-fonts.txt');
  const declaredLicense = pkg.license ?? entry.license ?? (pkg.name === 'khroma' && fs.readFileSync(path.join(directory,'license'),'utf8').startsWith('The MIT License (MIT)') ? 'MIT' : undefined);
  add({ ecosystem: 'npm', name: pkg.name, version: pkg.version, license: declaredLicense, directory, source: entry.resolved ?? `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`, repo: repository(pkg.repository), authors: pkg.author ?? pkg.contributors ?? [], additional, sources: pkg.name === 'elkjs' });
}

const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
const used = new Set();
function visit(key) {
  if (used.has(key)) return;
  used.add(key);
  for (const dep of nodes.get(key)?.deps ?? []) if (dep.dep_kinds.some(kind => kind.kind !== 'dev')) visit(dep.pkg);
}
visit(metadata.resolve.root);
for (const pkg of metadata.packages.filter(pkg => used.has(pkg.id) && !metadata.workspace_members.includes(pkg.id))) {
  const directory = path.dirname(pkg.manifest_path), additional = [];
  if (pkg.name === 'alloc-stdlib') additional.push('BSD-3-Clause-alloc.txt');
  if (pkg.name === 'clipboard-win') additional.push('BSL-1.0.txt');
  if (['onenote_parser', 'onenote_parser-macros', 'selectors'].includes(pkg.name)) additional.push('MPL-2.0.txt');
  if (pkg.name.startsWith('webview2-com')) additional.push('MIT-webview2.txt');
  if (pkg.name === 'tauri-plugin') {
    const tauri = metadata.packages.find(item => item.name === 'tauri');
    additional.push(...licenseFiles(path.dirname(tauri.manifest_path)));
  }
  if (pkg.license_file) additional.push(path.resolve(directory, pkg.license_file));
  add({ ecosystem: 'cargo', name: pkg.name, version: pkg.version, license: pkg.license, directory, source: `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`, repo: pkg.repository ?? '', authors: pkg.authors, additional, sources: /^MPL-2\.0$/.test(pkg.license ?? '') });
}
records.sort((a, b) => `${a.ecosystem}/${a.name}/${a.version}`.localeCompare(`${b.ecosystem}/${b.name}/${b.version}`));
fs.writeFileSync(path.join(output, 'dependencies.json'), JSON.stringify({ target, dependencies: records }, null, 2) + '\n');
const notes = [
  '# MarkFolio · 第三方依赖与资源', '',
  '此目录按前端锁文件及当前平台 Cargo 依赖生成，保留上游许可证与署名；不包含 MarkFolio 自身的公开许可授权。',
  '依赖版本和来源见 dependencies.json，各许可证全文位于 licenses/。直接与间接依赖均列出，清单也可能包含构建时使用的组件。',
  'MPL-2.0 组件与 elkjs 的当前包源码随 sources/ 提供，未修改这些依赖。原始源码下载地址和上游仓库同时列在清单中。elkjs 使用其 EPL-2.0 许可选项，DOMPurify 使用 Apache-2.0 选项。',
  '中英文 OCR 模型来自 @tesseract.js-data 包；包装包声明 MIT，模型数据同时附 Tesseract 的 Apache-2.0 文本。KaTeX 字体与生成源声明一并收集；PDF.js 的 Foxit/Liberation 字体声明位于对应包许可证子目录。',
  'MIT-standard.txt 是 SPDX 的标准许可文本，用于未附许可文件的 OCR 包装包；署名和包来源以 dependencies.json 的公开发布元数据为准。',
  '软件版本更新后必须重新生成此目录。未改动上游的许可/版权声明。', '',
  '| 组件 | 版本 | 声明许可 |', '|---|---|---|',
  ...records.map(record => `| ${record.ecosystem}/${record.name} | ${record.version} | ${record.license} |`), '',
];
fs.writeFileSync(path.join(output, 'THIRD-PARTY-NOTICES.md'), notes.join('\n'));
console.log(`[notices] ${records.length} locked dependencies; licenses and component sources collected`);
