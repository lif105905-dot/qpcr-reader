#!/bin/zsh
# 一键重新打包：网页 + Western → Electron 主程序 → 安装到用户目录 → 重建 /Applications 启动器
#
# 为什么分两层（别改回去）：
#   这台机器（macOS 15）会拒绝「经 LaunchServices 启动的 ad-hoc 签名 Electron 包」——
#   双击后进程 0.1 秒内退出、什么都不发生。所以：
#     · 主程序放在 ~/Library/Application Support/LabKit/LabKit.app（不经过 LS 启动）
#     · /Applications/LabKit.app 只是一个 shell 启动器，双击时 exec 主程序
#   如果把 Electron 包直接 ditto 到 /Applications，就会把启动器盖掉 → 双击没反应、
#   或者打开的仍是旧版本。这一条踩过一次，见 说明.txt「〇、名字与图标」。
set -e

REPO="/Users/lijiehui/Documents/qpcr-tool/zpcrweb"
NODE="/usr/local/bin/node"
MAIN="$HOME/Library/Application Support/LabKit/LabKit.app"
LAUNCHER="/Applications/LabKit.app"
DESKTOP="$HOME/Desktop/LabKit.app"
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

cd "$REPO"

echo "▸ 1/5 构建 qPCR 网页（含中文化插件）"
npm run build -w @zpcrweb/web | tail -2

echo "▸ 2/5 打包 Electron 主程序（含 Western 页面）"
cd "$REPO/apps/desktop"
"$NODE" ../../node_modules/electron-builder/cli.js --mac --dir | grep -E "packaging|error" || true

echo "▸ 3/5 更新主程序到用户目录"
pkill -f "LabKit.app/Contents/MacOS/LabKit" 2>/dev/null || true
sleep 1
mkdir -p "$(dirname "$MAIN")"
rm -rf "$MAIN"
ditto --noextattr --norsrc "$REPO/apps/desktop/out/mac-arm64/LabKit.app" "$MAIN"

echo "▸ 4/5 重建 /Applications 启动器"
rm -rf "$LAUNCHER"
mkdir -p "$LAUNCHER/Contents/MacOS" "$LAUNCHER/Contents/Resources"
cp "$REPO/apps/desktop/build/icon.icns" "$LAUNCHER/Contents/Resources/icon.icns"
cat > "$LAUNCHER/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key><string>run</string>
	<key>CFBundleIdentifier</key><string>local.labkit.launcher</string>
	<key>CFBundleName</key><string>LabKit</string>
	<key>CFBundleDisplayName</key><string>LabKit</string>
	<key>CFBundleIconFile</key><string>icon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>1.0</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
cat > "$LAUNCHER/Contents/MacOS/run" <<'RUN'
#!/bin/sh
APP="$HOME/Library/Application Support/LabKit/LabKit.app/Contents/MacOS/LabKit"
if [ ! -x "$APP" ]; then
  osascript -e 'display alert "找不到 LabKit 主程序" message "请重新运行 重新打包.command 安装一遍。"'
  exit 1
fi
exec env -u ELECTRON_RUN_AS_NODE "$APP" "$@" >>/tmp/labkit.log 2>&1
RUN
chmod +x "$LAUNCHER/Contents/MacOS/run"
codesign --force --sign - "$LAUNCHER" >/dev/null 2>&1 || true

echo "▸ 5/5 刷新图标缓存与桌面图标"
rm -f "$DESKTOP"
ln -s "$LAUNCHER" "$DESKTOP"
touch "$LAUNCHER"
"$LSR" -f "$LAUNCHER" >/dev/null 2>&1 || true

echo "✅ 完成。双击桌面上的「LabKit.app」打开。"
