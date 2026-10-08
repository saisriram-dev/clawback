@echo off
setlocal
title ClawBack
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   ClawBack needs Node.js 22 LTS or newer.
  echo   1. Download and install it from https://nodejs.org  ^(choose "LTS"^)
  echo   2. Close this window and double-click start.bat again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node scripts\launch.mjs %*
if errorlevel 1 pause
