#!/bin/bash

# FLVX 自动探测安装脚本
# 根据网络环境自动选择最优下载源

set -e

# 检查并安装必要的下载工具
install_download_tools() {
  local need_install=0
  
  if ! command -v curl &> /dev/null; then
    echo "⚠️  未检测到 curl"
    need_install=1
  fi
  
  if ! command -v wget &> /dev/null; then
    echo "⚠️  未检测到 wget"
    need_install=1
  fi
  
  if [ $need_install -eq 0 ]; then
    return 0
  fi
  
  echo "🔧 正在安装缺失的下载工具..."
  
  OS_TYPE=$(uname -s)
  
  if [[ "$OS_TYPE" == "Darwin" ]]; then
    if command -v brew &> /dev/null; then
      brew install curl wget
    else
      echo "❌ 未检测到 Homebrew，请手动安装 curl 和 wget"
      exit 1
    fi
    return 0
  fi
  
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
  elif [ -f /etc/redhat-release ]; then
    DISTRO="rhel"
  elif [ -f /etc/debian_version ]; then
    DISTRO="debian"
  else
    DISTRO="unknown"
  fi
  
  case $DISTRO in
    ubuntu|debian|kali)
      apt update
      apt install -y curl wget
      ;;
    centos|rhel|fedora|almalinux|rocky)
      if command -v dnf &> /dev/null; then
        dnf install -y curl wget
      elif command -v yum &> /dev/null; then
        yum install -y curl wget
      fi
      ;;
    alpine)
      apk add --no-cache curl wget
      ;;
    arch|manjaro|endeavouros)
      pacman -S --noconfirm curl wget
      ;;
    opensuse*|sles)
      zypper install -y curl wget
      ;;
    void)
      xbps-install -Sy curl wget
      ;;
    gentoo)
      emerge --ask=n net-misc/curl net-misc/wget
      ;;
    *)
      echo "⚠️  未知发行版，请手动安装 curl 和 wget"
      exit 1
      ;;
  esac
  
  echo "✅ 下载工具安装完成"
}

install_download_tools

# 接收所有参数（包括 -a, -s, -n 等）
AUTO_ARGS="$@"

echo "🔍 正在检测网络环境..."

# 网络环境探测（参考 nyanpass 逻辑）
CN=0
OS=0
NW_FAIL=0

# 尝试 1：检测 Apple 判断是否国内网络
do_apple_detect() {
  echo "🍎 检测 Apple 网络..."
  local out=$(curl --retry 3 --retry-delay 1 --max-time 3 -sI http://www.apple.com/ 2>/dev/null || echo "")
  if [ $? -ne 0 ] || [ -z "$out" ]; then
    NW_FAIL=1
  else
    out=$(echo "$out" | grep -i "geo=cn" || echo "")
    if [ -n "$out" ]; then
      CN=1
      echo "✅ 检测到国内网络 (Apple geo=cn)"
    else
      OS=1
      echo "✅ 检测到海外网络 (Apple 无 geo=cn)"
    fi
  fi
}

# 尝试 2：检测 Cloudflare 判断位置
do_cloudflare_detect() {
  echo "☁️  检测 Cloudflare 网络..."
  local out=$(curl --retry 3 --retry-delay 1 --max-time 3 -s https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null || echo "")
  if [ $? -ne 0 ] || [ -z "$out" ]; then
    NW_FAIL=1
  else
    out=$(echo "$out" | grep -i "loc=CN" || echo "")
    if [ -n "$out" ]; then
      CN=1
      echo "✅ 检测到国内网络 (Cloudflare loc=CN)"
    else
      OS=1
      echo "✅ 检测到海外网络 (Cloudflare 非 CN)"
    fi
  fi
}

# 主检测逻辑
do_apple_detect
if [ "$CN" != "1" ]; then
  do_cloudflare_detect
fi

# 接收环境变量
DOMESTIC_DOWNLOAD_URL="${DOMESTIC_DOWNLOAD_URL:-}"
GLOBAL_DOWNLOAD_URL="${GLOBAL_DOWNLOAD_URL:-}"

# 根据检测结果设置下载源
if [ "$CN" == "1" ]; then
  # 国内网络：使用国内加速地址
  if [ -n "$DOMESTIC_DOWNLOAD_URL" ]; then
    DOWNLOAD_HOSTS=(
      "$DOMESTIC_DOWNLOAD_URL"
      "https://chfs.646321.xyz:8/chfs/shared/flvx"
      "$GLOBAL_DOWNLOAD_URL"
      "https://ghfast.top/https://github.com/abai569/flvx/releases/latest/download"
    )
  else
    DOWNLOAD_HOSTS=(
      "https://chfs.646321.xyz:8/chfs/shared/flvx"
      "$GLOBAL_DOWNLOAD_URL"
      "https://ghfast.top/https://github.com/abai569/flvx/releases/latest/download"
    )
  fi
  echo "🌏 使用国内加速地址"
elif [ "$OS" == "1" ]; then
  # 海外网络：使用 GitHub 加速
  if [ -n "$GLOBAL_DOWNLOAD_URL" ]; then
    DOWNLOAD_HOSTS=(
      "https://chfs.646321.xyz:8/chfs/shared/flvx" 
      "https://gh-proxy.com/https://github.com/abai569/flvx/releases/latest/download"
      "$GLOBAL_DOWNLOAD_URL"
      "https://ghfast.top/https://github.com/abai569/flvx/releases/latest/download"
    )
  else
    DOWNLOAD_HOSTS=(
      "https://chfs.646321.xyz:8/chfs/shared/flvx" 
      "https://gh-proxy.com/https://github.com/abai569/flvx/releases/latest/download"
      "https://ghfast.top/https://github.com/abai569/flvx/releases/latest/download"
    )
  fi
  echo "🌍 使用 GitHub 加速"
else
  # 检测失败：默认使用 GitHub
  DOWNLOAD_HOSTS=(
    "https://chfs.646321.xyz:8/chfs/shared/flvx" 
    "https://github.com/abai569/flvx/releases/latest/download"
    "$GLOBAL_DOWNLOAD_URL"
    "https://ghfast.top/https://github.com/abai569/flvx/releases/latest/download"
  )
  echo "⚠️  网络检测失败，使用 GitHub 加速"
fi

# 循环尝试每个下载源
for host in "${DOWNLOAD_HOSTS[@]}"; do
  [ -z "$host" ] && continue
  echo "⬇️  尝试从 $host 下载..."
  if wget -q --timeout=30 "$host/install.sh" -O "./install_temp.sh" 2>/dev/null; then
    if [ -s "./install_temp.sh" ]; then
      if head -1 "./install_temp.sh" | grep -q "^#!"; then
        echo "✅ 下载成功，使用源：$host"
        chmod +x ./install_temp.sh
        # 传递 SCRIPT_URL 给 install.sh，让它知道下载源
        SCRIPT_URL="$host/install.sh" ./install_temp.sh $AUTO_ARGS
        exit 0
      else
        echo "⚠️  下载的文件无效，不是有效的脚本"
        rm -f ./install_temp.sh
      fi
    fi
  fi
done

echo " 所有下载源都失败，请检查网络连接"
echo "💡 提示：可以尝试手动指定下载源"
echo "   推荐：curl -L https://chfs.646321.xyz:8/chfs/shared/flvx/install.sh -o ./install.sh"
echo "   备用：curl -L https://github.com/abai569/flvx/releases/latest/download/install.sh -o ./install.sh"
exit 1
