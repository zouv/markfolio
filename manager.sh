#!/usr/bin/env bash
# =============================================================================
# manager.sh — markfolio 项目统一管理脚本（本项目所有命令的唯一来源）
# 用法：./manager.sh <command> [args]    (Windows: sh manager.sh <command>，在 Git Bash 里)
#
# 前端在项目根（React + Vite），Rust / Tauri 后端在 src-tauri/。
# 版本号只在 src-tauri/Cargo.toml；开发端口只在 src-tauri/tauri.conf.json 的 build.devUrl。
# 新增或修改命令时，同步 README 的命令表与 AGENTS.md §4（sh check-docs.sh 会核对 help 与 README 是否一致）。
# =============================================================================
# 被 `sh manager.sh` 调起且 sh 不是 bash（如 Debian 的 dash）时，自动改用 bash 重跑。
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${PROJECT_ROOT}/.runtime"
CARGO_MANIFEST="${PROJECT_ROOT}/src-tauri/Cargo.toml"
PM="npm"
cd "${PROJECT_ROOT}"   # 从任何目录调用都在项目根执行

log()  { printf "\033[1;34m[manager]\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m[ ok  ]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[warn ]\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m[err  ]\033[0m %s\n" "$*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "缺少命令：$1${2:+（$2）}"; exit 1; }
}

ensure_deps() {
  [ -d "${PROJECT_ROOT}/node_modules" ] || { err "前端依赖未安装：先 sh manager.sh setup"; exit 1; }
}

require_node_runtime() {
  require_cmd node
  case "${PM}" in
    npm)  require_cmd npm ;;
    pnpm) require_cmd pnpm "安装：npm i -g pnpm" ;;
    yarn) require_cmd yarn "安装：npm i -g yarn" ;;
    *)    err "未知包管理器：${PM}（只支持 npm / pnpm / yarn）"; exit 1 ;;
  esac
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (!((a===20&&b>=19)||(a===22&&b>=12)||a>22)) process.exit(1)' \
    || { err "Node.js 版本过低或不受 Vite 支持：需要 20.19+ 或 22.12+（当前 $(node --version)）"; exit 1; }
}
require_node() { require_node_runtime; ensure_deps; }
require_rust() { require_cmd cargo "安装 Rust：https://rustup.rs"; require_cmd rustc; }

# 统一通过选定的包管理器执行脚本（npm / pnpm / yarn 的 run 语法一致）。
run_pm() { "${PM}" "$@"; }

# 依赖安装：npm 用 ci，pnpm / yarn 用 frozen lockfile；没有锁文件时退回普通 install。
install_deps() {
  case "${PM}" in
    npm)
      if [ -f "${PROJECT_ROOT}/package-lock.json" ]; then npm ci --no-audit --no-fund
      else npm install --no-audit --no-fund; fi
      ;;
    pnpm)
      if [ -f "${PROJECT_ROOT}/pnpm-lock.yaml" ]; then pnpm install --frozen-lockfile
      else pnpm install; fi
      ;;
    yarn)
      if [ -f "${PROJECT_ROOT}/yarn.lock" ]; then yarn install --frozen-lockfile
      else yarn install; fi
      ;;
  esac
}

# --------------------------------------------------------------------------- #
# 安装 / 开发 / 构建 / 测试
# --------------------------------------------------------------------------- #

cmd_setup() {
  require_node_runtime
  require_cmd cargo "安装 Rust：https://rustup.rs"
  log "安装前端依赖（${PM}）"
  install_deps
  ok "安装完成：sh manager.sh dev 启动桌面开发模式"
}

cmd_dev() {
  require_node; require_rust
  log "关闭运行中的实例（若有），然后 tauri dev：Vite + Rust（Ctrl-C 退出）"
  node "${PROJECT_ROOT}/scripts/process-guard.mjs" --force
  run_pm run desktop:dev "$@"
}

cmd_web() {
  require_node
  log "只启动 Vite（浏览器预览；IPC 不可用）"
  run_pm run web:dev "$@"
}

cmd_build() {
  require_node
  log "构建前端（tsc --noEmit + vite build，产物 dist/web）"
  run_pm run web:build
  ok "前端已构建：dist/web/"
}

# 全部跑完再汇总：某一项失败时其余照样执行，日志里不会把「没跑」误当成「通过」。
cmd_test() {
  require_node; require_rust
  local failed=""
  log "tsc --noEmit";  run_pm run typecheck || failed="${failed} typecheck"
  log "node:test";     run_pm test          || failed="${failed} node-test"
  log "cargo test"
  cargo test --manifest-path "${CARGO_MANIFEST}" || failed="${failed} cargo-test"
  if [ -n "${MARKFOLIO_TEST_ONENOTE:-}" ]; then
    cargo test --manifest-path "${CARGO_MANIFEST}" --test library native_onenote_sections -- --ignored || failed="${failed} onenote-test"
  fi
  if [ -n "${MARKFOLIO_TEST_DESKTOP:-}" ]; then
    cargo test --manifest-path "${CARGO_MANIFEST}" --test library native_pdf_export -- --ignored || failed="${failed} pdf-test"
  fi
  if [ -n "${failed}" ]; then
    err "未通过：${failed# }（各项都已跑完，见上方各自输出）"
    exit 1
  fi
  ok "tsc / node:test / cargo test 全部通过"
}

cmd_check() {
  require_node; require_rust
  local failed=""
  if [ "${1:-}" = "--fix" ]; then cargo fmt --manifest-path "${CARGO_MANIFEST}" --all || failed="${failed} cargo-fmt-fix"; fi
  log "cargo fmt --check"; cargo fmt --manifest-path "${CARGO_MANIFEST}" --all -- --check || failed="${failed} cargo-fmt"
  log "cargo clippy";      cargo clippy --manifest-path "${CARGO_MANIFEST}" --all-targets -- -D warnings || failed="${failed} cargo-clippy"
  log "tsc --noEmit";      run_pm run typecheck || failed="${failed} typecheck"
  if [ -n "${failed}" ]; then
    err "未通过：${failed# }（各项都已跑完，见上方各自输出）"
    exit 1
  fi
  ok "cargo fmt / clippy / tsc 全部通过"
}
cmd_test_ui() {
  require_node
  log "界面交互测试（独立无头 Chrome，不使用个人浏览器资料）"
  run_pm run test:ui
}

cmd_package() {
  require_node; require_rust
  log "打包到 dist/dev 与 dist/release（tauri build + tauri build --debug，首次很慢）"
  node "${PROJECT_ROOT}/scripts/package.mjs" --pm "${PM}" "$@"
}

# --------------------------------------------------------------------------- #
# 杂项
# --------------------------------------------------------------------------- #

cmd_check_docs() {
  sh "${PROJECT_ROOT}/check-docs.sh" "$@"
}

cmd_clean() {
  log "清理 dist/、src-tauri/target/、src-tauri/gen/schemas/、.runtime/"
  rm -rf "${PROJECT_ROOT}/dist" "${PROJECT_ROOT}/src-tauri/target" \
         "${PROJECT_ROOT}/src-tauri/gen/schemas" "${RUNTIME_DIR}"
  if [ "${1:-}" = "--all" ]; then
    log "同时清理 node_modules/"
    rm -rf "${PROJECT_ROOT}/node_modules"
  fi
  ok "已清理；要重建依赖用 sh manager.sh setup"
}

cmd_help() {
  cat <<EOF
markfolio — manager.sh（本项目所有命令的唯一来源）

用法：
  ./manager.sh <command> [args]    (Windows: sh manager.sh <command>)

命令：
  setup        首次安装前端依赖（npm；有锁文件时用 frozen/ci）
  dev          开发模式：tauri dev（Vite + Rust，热更新）
  web          仅启动 Vite 预览前端（浏览器里，IPC 不可用）
  build        构建前端到 dist/web/（tsc --noEmit + vite build）
  test         跑 tsc + node 契约测试 + cargo test（全部跑完再汇总）
  test-ui      使用已安装 Chrome 验证设置、多选与快捷键界面
  check        cargo fmt --check + cargo clippy -D warnings + tsc（--fix 先整理 Rust 格式）
  package      出包到 dist/dev（Debug 调试包）与 dist/release（unpack/ + 免安装 zip + 安装包 + SHA256SUMS；--skip-build 复用已有构建）
  clean        清理 dist/、src-tauri/target、.runtime（--all 连 node_modules）
  check-docs   文档体系机械体检（同 sh check-docs.sh）
  help         显示本帮助
EOF
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "${cmd}" in
    setup)      cmd_setup      "$@" ;;
    dev)        cmd_dev        "$@" ;;
    web)        cmd_web        "$@" ;;
    build)      cmd_build      "$@" ;;
    test)       cmd_test       "$@" ;;
    test-ui)    cmd_test_ui    "$@" ;;
    check)      cmd_check      "$@" ;;
    package|pack) cmd_package "$@" ;;
    clean)      cmd_clean      "$@" ;;
    check-docs) cmd_check_docs "$@" ;;
    help|-h|--help) cmd_help ;;
    *) err "未知命令：${cmd}"; cmd_help; exit 2 ;;
  esac
}

main "$@"
