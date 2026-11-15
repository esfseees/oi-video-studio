#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VER=$(node -p "require('./package.json').version")
APP_NAME="信奥讲解视频工坊"
WIN_STAGE="dist/OIVideoStudio"
WIN_ZIP="dist/${APP_NAME}-v${VER}-windows-x64.zip"
WIN_SETUP="dist/${APP_NAME}-v${VER}-windows-x64-setup.exe"

NODE_WIN="${OIVS_WIN_NODE:-/Users/tt/Documents/Codex/2026-11-15/ba/work/win_deps/node-win-x64/node.exe}"
FFMPEG_WIN="${OIVS_WIN_FFMPEG:-/Users/tt/Documents/Codex/2026-11-15/ba/work/win_deps/ffmpeg.exe}"

echo "[1/5] 正在准备 Windows x64 目录结构: $WIN_STAGE"
rm -rf "$WIN_STAGE" "$WIN_ZIP" "$WIN_SETUP"
mkdir -p "$WIN_STAGE/runtime" "$WIN_STAGE/app"

cp "$NODE_WIN" "$WIN_STAGE/runtime/node.exe"
cp "$FFMPEG_WIN" "$WIN_STAGE/runtime/ffmpeg.exe"

rsync -a \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude 'data' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  "$ROOT/" "$WIN_STAGE/app/"

echo "[2/5] 正在生成原生 Windows x64 GUI 启动器 (${APP_NAME}.exe)..."
node -e '
const { buildWin64GuiExe } = require("./desktop/make_win_exe.js");
buildWin64GuiExe({
  icoPath: "./desktop/icon.ico",
  cmdLineTemplate: "\"runtime\\node.exe\" \"app\\scripts\\start.js\"",
  outPath: "./dist/OIVideoStudio/信奥讲解视频工坊.exe",
  mode: "launcher"
});
'

cat << 'BAT' > "$WIN_STAGE/启动局域网共享模式.bat"
@echo off
chcp 65001 >nul
cd /d "%~dp0app"
set "OIVS_DATA_DIR=%APPDATA%\OIVideoStudio"
set "OIVS_FFMPEG=%~dp0runtime\ffmpeg.exe"
"%~dp0runtime\node.exe" scripts\start.js --lan
pause
BAT

echo "[3/5] 正在打包 Windows 便携版压缩包: $WIN_ZIP"
(cd "$WIN_STAGE" && zip -r -q -X "$ROOT/$WIN_ZIP" .)

echo "[4/5] 正在生成 Windows 单文件图形化安装程序: $WIN_SETUP"
node -e '
const { buildWin64SetupInstallerExe } = require("./desktop/make_win_exe.js");
buildWin64SetupInstallerExe({
  icoPath: "./desktop/icon.ico",
  payloadZipPath: process.argv[1],
  outPath: process.argv[2]
}).then(sz => console.log("Setup EXE size:", sz));
' "$ROOT/$WIN_ZIP" "$ROOT/$WIN_SETUP"

rm -rf "$WIN_STAGE"
echo "[5/5] Windows 双格式安装包构建完成："
ls -lh "$ROOT/$WIN_ZIP" "$ROOT/$WIN_SETUP"
