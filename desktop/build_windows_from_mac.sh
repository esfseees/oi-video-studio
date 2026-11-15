#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VER=$(node -p "require('./package.json').version")
APP_NAME="信奥讲解视频工坊"
WIN_STAGE="dist/OIVideoStudio"
WIN_ZIP="dist/${APP_NAME}-v${VER}-windows-x64.zip"
WIN_SETUP="dist/${APP_NAME}-v${VER}-windows-x64-setup.exe"

NODE_WIN="${OIVS_WIN_NODE:-/Users/tt/Documents/Codex/2026-11-15/ba/work/win_deps/node.exe}"
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

echo "[2/5] 正在生成原生 Windows x64 启动器 (OIVideoStudio.exe 与 ${APP_NAME}.exe)..."
node -e '
const { buildWin64GuiExe } = require("./desktop/make_win_exe.js");
const opts = {
  icoPath: "./desktop/icon.ico",
  cmdLineTemplate: "\"runtime\\node.exe\" \"app\\scripts\\start.js\"",
  mode: "launcher",
  checkFiles: ["runtime\\node.exe", "runtime\\ffmpeg.exe", "app\\scripts\\start.js", "app\\server.js"],
  errTitle: "信奥讲解视频工坊 - 启动错误",
  errMissingMsg: "找不到核心运行文件（runtime\\node.exe、runtime\\ffmpeg.exe 或 app\\scripts\\start.js）。\r\n请确保已将压缩包完整解压到文件夹后再运行，不要直接在压缩包内双击。",
  errLaunchMsg: "启动 Node.js 服务进程失败，请检查系统权限或杀毒软件拦截设置。",
  showConsole: true
};
buildWin64GuiExe({ ...opts, outPath: "./dist/OIVideoStudio/OIVideoStudio.exe" });
buildWin64GuiExe({ ...opts, outPath: "./dist/OIVideoStudio/信奥讲解视频工坊.exe" });
'

cat << 'BAT' > "$WIN_STAGE/start-lan.bat"
@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo [错误] 找不到 "%~dp0runtime\node.exe"，请先将压缩包完整解压后再运行。
  pause
  exit /b 1
)
if not exist "%~dp0app\scripts\start.js" (
  echo [错误] 找不到 "%~dp0app\scripts\start.js"，请先将压缩包完整解压后再运行。
  pause
  exit /b 1
)
cd /d "%~dp0app"
set "OIVS_DATA_DIR=%APPDATA%\OIVideoStudio"
set "OIVS_FFMPEG=%~dp0runtime\ffmpeg.exe"
"%~dp0runtime\node.exe" scripts\start.js --lan
pause
BAT
cp "$WIN_STAGE/start-lan.bat" "$WIN_STAGE/启动局域网共享模式.bat"

echo "[3/5] 正在使用 UTF-8 标志位 (0x0800) 打包 Windows 便携版压缩包: $WIN_ZIP"
python3 "$ROOT/scripts/make_utf8_zip.py" "$WIN_STAGE" "$ROOT/$WIN_ZIP" --exclude ".git,.venv,data,dist,.env,.DS_Store,__pycache__"

echo "[4/5] 正在生成带 UTF-8 解压、目标文件校验与图形错误弹窗的 Windows 安装程序: $WIN_SETUP"
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
