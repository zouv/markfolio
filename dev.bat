@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ============================================================
rem  Markfolio - dev: run tauri dev (Vite + Rust, hot reload).
rem  A running app instance is force-closed before the build starts.
rem  Pure cmd; no Git Bash required. Mirrors: sh manager.sh dev
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

if not exist node_modules (
    echo [INFO] node_modules missing, running setup first...
    call "%~dp0setup.bat"
    if errorlevel 1 goto :Fail
)

echo [INFO] Closing any running MarkFolio instance...
node "%~dp0scripts\process-guard.mjs" --force
if errorlevel 1 goto :Fail

echo ============================================================
echo  Dev    ^|  tauri dev ^(Vite + Rust^)
echo ============================================================
call %PM% run desktop:dev %*
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
    echo.
    echo [FAILED] Dev exited with code %RC%.
    echo         Check the messages above, then re-run.
    if not "%MARKFOLIO_NO_PAUSE%"=="1" pause
    exit /b %RC%
)
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
echo [FAILED] Dev aborted.
if not "%MARKFOLIO_NO_PAUSE%"=="1" pause
exit /b 1
