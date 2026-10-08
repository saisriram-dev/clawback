@echo off
setlocal
title ClawBack - set up Gemma
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   ClawBack needs Node.js 22 LTS or newer. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node scripts\setup-gemma.mjs
pause
