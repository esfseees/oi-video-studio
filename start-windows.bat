@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 还没有安装 Node.js，请先到 https://nodejs.org 下载安装 LTS 版，然后重新双击本文件。
  pause
  exit /b 1
)
node scripts\start.js
pause
