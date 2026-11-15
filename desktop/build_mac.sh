#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VER=$(node -p "require('./package.json').version")
APP_NAME="信奥讲解视频工坊"
APP_BUNDLE="dist/${APP_NAME}.app"
DMG_OUT="dist/${APP_NAME}-v${VER}-macos-arm64.dmg"
ZIP_OUT="dist/${APP_NAME}-v${VER}-macos-arm64.zip"

NODE_BIN="${OIVS_BUNDLE_NODE:-/Users/tt/Library/Application Support/com.brainmaker.client/cowork-updates/node-binary/bin/node}"
FFMPEG_BIN="${OIVS_BUNDLE_FFMPEG:-/Users/tt/Library/Application Support/com.brainmaker.client/cowork-updates/ffmpeg-binary/ffmpeg}"
if [ ! -f "$NODE_BIN" ]; then NODE_BIN="$(command -v node)"; fi
if [ ! -f "$FFMPEG_BIN" ]; then FFMPEG_BIN="$(command -v ffmpeg)"; fi

echo "[1/5] 正在构建 macOS 应用包: ${APP_BUNDLE}"
rm -rf "$APP_BUNDLE" "$DMG_OUT" "$ZIP_OUT"
mkdir -p "$APP_BUNDLE/Contents/MacOS" \
         "$APP_BUNDLE/Contents/Resources/runtime" \
         "$APP_BUNDLE/Contents/Resources/app"

cp desktop/icon.icns "$APP_BUNDLE/Contents/Resources/icon.icns"
cp "$NODE_BIN" "$APP_BUNDLE/Contents/Resources/runtime/node"
cp "$FFMPEG_BIN" "$APP_BUNDLE/Contents/Resources/runtime/ffmpeg"
chmod +x "$APP_BUNDLE/Contents/Resources/runtime/node" "$APP_BUNDLE/Contents/Resources/runtime/ffmpeg"

# Copy app source & dependencies (excluding user data, venv, dist, git)
rsync -a \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude 'data' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  "$ROOT/" "$APP_BUNDLE/Contents/Resources/app/"

cat << PLIST > "$APP_BUNDLE/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.xiaotuling.oi-video-studio</string>
  <key>CFBundleVersion</key>
  <string>${VER}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VER}</string>
  <key>CFBundleExecutable</key>
  <string>OIVideoStudio</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat << 'LAUNCHER' > "$APP_BUNDLE/Contents/MacOS/OIVideoStudio"
#!/bin/zsh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$DIR/Resources/runtime"
APP="$DIR/Resources/app"
export OIVS_DATA_DIR="${OIVS_DATA_DIR:-$HOME/Library/Application Support/OIVideoStudio}"
export OIVS_FFMPEG="$RUNTIME/ffmpeg"
export PATH="$RUNTIME:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$OIVS_DATA_DIR"
LOG="$OIVS_DATA_DIR/app.log"

if [[ "${1:-}" == "--self-test" ]]; then
  exec "$RUNTIME/node" "$APP/scripts/start.js" --self-test
fi

# If server is already listening on 5178, just open browser
if lsof -iTCP:5178 -sTCP:LISTEN -t >/dev/null 2>&1; then
  open "http://127.0.0.1:5178"
  exit 0
fi

cd "$APP"
exec "$RUNTIME/node" "$APP/scripts/start.js" >>"$LOG" 2>&1
LAUNCHER
chmod +x "$APP_BUNDLE/Contents/MacOS/OIVideoStudio"

echo "[2/5] 正在进行 Ad-hoc 签名与验证..."
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

echo "[3/5] 正在执行内建自检 (--self-test)..."
"$APP_BUNDLE/Contents/MacOS/OIVideoStudio" --self-test

echo "[4/5] 正在打包 macOS ZIP..."
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_OUT"

echo "[5/5] 正在打包 macOS DMG 安装镜像..."
DMG_STAGE=$(mktemp -d)
cp -R "$APP_BUNDLE" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"
hdiutil create -volname "${APP_NAME}" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_OUT" >/dev/null
rm -rf "$DMG_STAGE"

echo "构建完成："
echo "  APP: $ROOT/$APP_BUNDLE"
echo "  DMG: $ROOT/$DMG_OUT"
echo "  ZIP: $ROOT/$ZIP_OUT"
