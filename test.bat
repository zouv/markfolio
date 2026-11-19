@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ============================================================
rem  Markfolio - test: tsc + node:test contract + cargo test.
rem  Pure cmd; no Git Bash required. Mirrors: sh manager.sh test
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

echo ============================================================
echo  Test   ^|  tsc + node:test + cargo test
echo ============================================================

call %PM% run typecheck
if errorlevel 1 goto :TypecheckFailed
call %PM% test
if errorlevel 1 goto :NodeTestFailed

pushd "%~dp0src-tauri"
cargo test
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto :CargoFailed

popd
echo.
echo [SUCCESS] All tests passed.
exit /b 0

:TypecheckFailed
echo.
echo [FAILED] tsc --noEmit failed.
goto :Fail
:NodeTestFailed
echo.
echo [FAILED] node:test contract tests failed.
goto :Fail
:CargoFailed
echo.
echo [FAILED] cargo test failed.
goto :Fail
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
echo [FAILED] Tests failed.
if not "%MARKFOLIO_NO_PAUSE%"=="1" pause
exit /b 1
