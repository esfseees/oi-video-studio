# 信奥讲解视频工坊 —— 服务器部署镜像
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg chromium fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir edge-tts==7.3.1
COPY server.js ./
COPY lib lib
COPY player player
COPY public public
COPY builtin builtin
ENV HOST=0.0.0.0 PORT=5178 CHROME_PATH=/usr/bin/chromium CHROME_NO_SANDBOX=1
EXPOSE 5178
VOLUME /app/data
CMD ["node", "server.js"]
