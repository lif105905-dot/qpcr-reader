#!/bin/zsh
# 提交并上传本次改动到远端仓库。
# 用法：
#   ./提交更新.command                 → 用自动生成的说明提交
#   ./提交更新.command "改了什么"      → 用自己写的说明提交
# 双击也可以（没有远端时只会提交到本地）。
set -e
cd "$(dirname "$0")"

MSG="$1"
if [[ -z "$MSG" ]]; then
  MSG="更新：$(date '+%Y-%m-%d %H:%M')"
fi

echo "▸ 检查改动"
if [[ -z "$(git status --porcelain)" ]]; then
  echo "没有需要提交的改动。"
  exit 0
fi
git status --short | head -30

echo "▸ 提交"
git add -A
git commit -q -m "$MSG"
git --no-pager log --oneline -1

if git remote get-url origin >/dev/null 2>&1; then
  echo "▸ 推送到 $(git remote get-url origin)"
  git push origin HEAD
  echo "✅ 已上传"
else
  echo "⚠️  还没有配置远端仓库，改动只提交到了本地。"
  echo "   配置一次即可：git remote add origin <仓库地址> && git push -u origin main"
fi
