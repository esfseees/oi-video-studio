#!/bin/zsh
# 双击启动「信奥讲解视频工坊」（只有这台电脑能访问）
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "还没有安装 Node.js。请先安装：brew install node，或到 https://nodejs.org 下载安装，然后重新双击本文件。"
  exit 1
fi
node scripts/start.js
