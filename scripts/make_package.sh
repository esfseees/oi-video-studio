#!/bin/zsh
# 打包成可以发给别人的压缩包：不含 API Key、已生成的视频、上传的角色和 Python 环境
# 使用 make_utf8_zip.py 强制写入 ZIP UTF-8 标志位 (0x0800)，彻底避免 Windows 解压中文文件名乱码
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${PWD:t}"; VER=$(node -p "require('./package.json').version"); OUT="dist/信奥讲解视频工坊-v$VER.zip"
mkdir -p dist
python3 scripts/make_utf8_zip.py "$PWD" "$PWD/$OUT" --prefix "$NAME" --exclude ".git,.venv,data,dist,.env,.DS_Store,__pycache__"
echo "已生成：$PWD/$OUT"
