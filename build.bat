@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ============================================================
rem  Markfolio - build: type-check and build the frontend into dist/web.
rem  Pure cmd; no Git Bash required. Mirrors: sh manager.sh build
rem ============================================================

pushd "%~dp0"
if errorlevel 1 exit /b 1
set "PM=npm"

where node >nul 2>&1
if errorlevel 1 goto :NoNode
where %PM% >nul 2>&1
if errorlevel 1 goto :NoPm

echo ============================================================
echo  Build  ^|  tsc --noEmit + vite build
echo ============================================================
call %PM% run web:build %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :Fail
popd

echo.
echo [SUCCESS] Frontend built: dist\
exit /b 0

:NoNode
echo [ERROR] Node.js 20.19+ or 22.12+ is required. Add node to PATH.
goto :Fail
:NoPm
echo [ERROR] %PM% is required. Install it or re-run init.sh with --pm.
goto :Fail

:Fail
popd
echo.
echo [FAILED] Build failed.
if not "%MARKFOLIO_NO_PAUSE%"=="1" pause
exit /b 1
