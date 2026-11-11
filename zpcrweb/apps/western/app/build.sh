#!/bin/bash
set -e
cd "$(dirname "$0")"
APP="$HOME/Applications/Western analysis.app"
node ../tools/build.mjs
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O App.swift -o "$APP/Contents/MacOS/WesternAnalysis"
cp Info.plist "$APP/Contents/Info.plist"
cp ../dist/WesternAnalysis.html "$APP/Contents/Resources/WesternAnalysis.html"
if [ -f ../assets/AppIcon.icns ]; then cp ../assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"; fi
codesign --force --deep --sign - "$APP" 2>/dev/null || true
echo "已生成: $APP"
