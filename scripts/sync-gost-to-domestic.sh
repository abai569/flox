#!/bin/bash
# 手动同步 gost 二进制文件到国内镜像源
# 使用方法：./scripts/sync-gost-to-domestic.sh

set -e

# 配置参数（可通过环境变量覆盖）
DOMESTIC_WEBDAV_URL="${DOMESTIC_WEBDAV_URL:-https://chfs.646321.xyz:8/webdav/flvx}"
DOMESTIC_USER="${DOMESTIC_USER:?DOMESTIC_USER not set}"
DOMESTIC_PASS="${DOMESTIC_PASS:?DOMESTIC_PASS not set}"
GITHUB_REPO="abai569/flvx"

echo "🔍 获取最新版本号..."
VERSION=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$VERSION" ]; then
    echo "❌ 获取版本号失败"
    exit 1
fi
echo "📦 最新版本：$VERSION"

# 创建临时目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "⬇️  下载 gost-amd64..."
curl -L "https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/gost-amd64" -o "$TEMP_DIR/gost-amd64"
if [ ! -s "$TEMP_DIR/gost-amd64" ]; then
    echo "❌ gost-amd64 下载失败"
    exit 1
fi

echo "⬇️  下载 gost-arm64..."
curl -L "https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/gost-arm64" -o "$TEMP_DIR/gost-arm64"
if [ ! -s "$TEMP_DIR/gost-arm64" ]; then
    echo "❌ gost-arm64 下载失败"
    exit 1
fi

echo "⬆️  通过 WebDAV 上传到国内镜像源..."
# 使用 WebDAV 上传
curl -u "${DOMESTIC_USER}:${DOMESTIC_PASS}" -T "$TEMP_DIR/gost-amd64" "${DOMESTIC_WEBDAV_URL}/gost-amd64"
if [ $? -ne 0 ]; then
    echo "❌ gost-amd64 上传失败"
    exit 1
fi

curl -u "${DOMESTIC_USER}:${DOMESTIC_PASS}" -T "$TEMP_DIR/gost-arm64" "${DOMESTIC_WEBDAV_URL}/gost-arm64"
if [ $? -ne 0 ]; then
    echo "❌ gost-arm64 上传失败"
    exit 1
fi

echo "✅ 同步完成"
echo "📁 已上传文件："
echo "   - ${DOMESTIC_WEBDAV_URL}/gost-amd64"
echo "   - ${DOMESTIC_WEBDAV_URL}/gost-arm64"
