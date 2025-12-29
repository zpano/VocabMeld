#!/bin/bash
# 统一的扩展打包脚本
# 用法: ./scripts/package.sh <output-filename>
# 示例: ./scripts/package.sh Sapling-1.0.0.zip

set -e

OUTPUT_NAME="${1:-Sapling.zip}"

mkdir -p release

zip -r "release/${OUTPUT_NAME}" \
  manifest.json \
  *.html \
  icons/ \
  css/ \
  js/ \
  dist/ \
  vendor/ \
  wordlist/ \
  _locales/ \
  -x "*.map" \
  -x "node_modules/*" \
  -x ".git/*" \
  -x ".github/*" \
  -x "scripts/*"

echo "✓ 打包完成: release/${OUTPUT_NAME}"
