@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem ============================================================
rem  Markfolio - clean: remove dist/, src-tauri\target/, .runtime/.
rem  Use "clean.bat --all" to remove node_modules too.
rem  Pure cmd; no Git Bash required. Mirrors: sh manager.sh clean
rem ============================================================

pushd "%~dp0"
if errorlevel 1 exit /b 1

echo ============================================================
echo  Clean  ^|  dist / src-tauri\target / .runtime
echo ============================================================
if exist "dist" rmdir /S /Q "dist" 2>nul
if exist "src-tauri\target" rmdir /S /Q "src-tauri\target" 2>nul
if exist ".runtime" rmdir /S /Q ".runtime" 2>nul
if /I "%~1"=="--all" (
    echo [INFO] Removing node_modules too...
    if exist "node_modules" rmdir /S /Q "node_modules" 2>nul
)

popd
echo.
echo [SUCCESS] Clean done.
if not "%MARKFOLIO_NO_PAUSE%"=="1" pause
exit /b 0
