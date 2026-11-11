#!/bin/bash
# 双击启动本地 qPCR 工具（会在终端里跑一个只监听 127.0.0.1 的静态服务器）
cd "$(dirname "$0")/zpcrweb/apps/web" || { echo "找不到 zpcrweb/apps/web"; exit 1; }
if [ ! -d dist ]; then
  echo "还没构建，正在构建…"
  cd .. && cd .. && npm run build -w @zpcrweb/core && npm run build -w @zpcrweb/web || exit 1
  cd apps/web
fi
echo "启动中… 浏览器会自动打开 http://127.0.0.1:4180"
echo "关掉这个终端窗口即停止服务。"
# 打开时把 CFX 标准版固定密码带过去：应用会在第一次读取时收下它、立刻从地址栏清掉，
# 并存进本机浏览器（localStorage），此后所有 .pcrd 自动解密，不用再手输。
# 密码里的 ! # $ 已在 URL 里转义。
URL='http://127.0.0.1:4180/?cfxPassword=SecureCompressDecompressKeyiQ5V4Files%21%21%23%23%24%24'
( sleep 3; open "$URL" ) &
exec npx vite preview --port 4180 --strictPort --host 127.0.0.1
