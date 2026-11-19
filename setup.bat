@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ============================================================
rem  Markfolio - setup: check toolchain and install frontend deps.
rem  Pure cmd; no Git Bash required. Mirrors: sh manager.sh setup
rem ============================================================

pushd "%~dp0"
if errorlevel 1 exit /b 1
set "PM=npm"

where node >nul 2>&1
if errorlevel 1 goto :NoNode
where %PM% >nul 2>&1
if errorlevel 1 goto :NoPm
where cargo >nul 2>&1
if errorlevel 1 goto :NoCargo
where rustc >nul 2>&1
if errorlevel 1 goto :NoCargo

echo ============================================================
echo  Setup  ^|  install frontend dependencies ^(%PM%^)
echo ============================================================

if /I "%PM%"=="pnpm" (
    if exist pnpm-lock.yaml (call pnpm install --frozen-lockfile) else (call pnpm install)
) else if /I "%PM%"=="yarn" (
    if exist yarn.lock (call yarn install --frozen-lockfile) else (call yarn install)
) else (
    if exist package-lock.json (call npm ci --no-audit --no-fund) else (call npm install --no-audit --no-fund)
)
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :Fail
popd

echo.
echo [SUCCESS] Dependencies installed. Use dev.bat to start.
exit /b 0

:NoNode
echo [ERROR] Node.js 20.19+ or 22.12+ is required. Add node to PATH.
goto :Fail
:NoPm
echo [ERROR] %PM% is required. Install it or re-run init.sh with --pm.
goto :Fail
:NoCargo
echo [ERROR] Rust toolchain is required. Install via https://rustup.rs
goto :Fail

:Fail
popd
echo.
echo [FAILED] Setup failed.
if not "%MARKFOLIO_NO_PAUSE%"=="1" pause
exit /b 1
