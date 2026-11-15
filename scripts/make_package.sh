#!/bin/zsh
# 打包成可以发给别人的压缩包：不含 API Key、已生成的视频、上传的角色和 Python 环境
cd "$(dirname "$0")/.."
NAME="${PWD:t}"; VER=$(node -p "require('./package.json').version"); OUT="dist/信奥讲解视频工坊-v$VER.zip"
mkdir -p dist
cd ..
zip -FS -r -q -X "$NAME/$OUT" "$NAME" \
  -x "$NAME/data/*" "$NAME/.venv/*" "$NAME/dist/*" "$NAME/.git/*" "$NAME/.env" "*.DS_Store" "*/__pycache__/*"
echo "已生成：$PWD/$NAME/$OUT"
