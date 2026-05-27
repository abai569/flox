#!/bin/bash
set -e

# 解决 macOS 下 tr 可能出现的非法字节序列问题
export LANG=en_US.UTF-8
export LC_ALL=C

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

# 脚本参数：指定版本号（可选），例如：bash panel_install.sh v3.6.6 或 <3.6.6>
ARG_VERSION="$1"
ARG_VERSION="${ARG_VERSION//<}"
ARG_VERSION="${ARG_VERSION//>}"

# GitHub repo used for release downloads
REPO="abai569/flvx"

# 固定版本号（Release 构建时自动填充，留空则获取最新版）
PINNED_VERSION=""

# 镜像加速（所有下载均经过镜像源，以支持 IPv6）
# maybe_proxy_url() {
#  local url="$1"
#   echo "https://gcode.hostcentral.cc/${url}"
# }

# 取消镜像加速，直接返回原地址
maybe_proxy_url() {
  local url="$1"
  echo "${url}"
}

resolve_latest_release_tag() {
  local tag

  # 使用 /releases 端点（包含 Pre-release），按创建时间倒序，取第一条
  tag=$(curl -fsSL --max-time 10 "https://api.github.com/repos/${REPO}/releases?per_page=1" 2>/dev/null | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  if [[ -n "$tag" ]]; then
    echo "$tag"
    return 0
  fi

  return 1
}

resolve_version() {
  if [[ -n "${VERSION:-}" ]]; then
    echo "$VERSION"
    return 0
  fi
  if [[ -n "$ARG_VERSION" ]]; then
    echo "$ARG_VERSION"
    return 0
  fi
  if [[ -n "${FLUX_VERSION:-}" ]]; then
    echo "$FLUX_VERSION"
    return 0
  fi
  if [[ -n "${PINNED_VERSION:-}" ]]; then
    echo "$PINNED_VERSION"
    return 0
  fi

  if resolve_latest_release_tag; then
    return 0
  fi

  echo "❌ 无法获取最新版本号。你可以手动指定版本，例如：VERSION=<版本号> ./panel_install.sh 或 bash panel_install.sh <版本号>" >&2
  return 1
}

# 根据版本号设置 compose 下载地址
set_compose_urls_by_version() {
  local version="$1"
  CURRENT_VERSION="$version"
  DOCKER_COMPOSEV4_URL=$(maybe_proxy_url "https://github.com/${REPO}/releases/download/${version}/docker-compose-v4.yml")
  DOCKER_COMPOSEV6_URL=$(maybe_proxy_url "https://github.com/${REPO}/releases/download/${version}/docker-compose-v6.yml")
}

# 替版本号翻转 v 前缀（有则去，无则加），供下载失败时重试
toggle_v_prefix() {
  local ver="$1"
  if [[ "$ver" == v* ]]; then
    echo "${ver#v}"
  else
    echo "v${ver}"
  fi
}

# 下载 compose 文件，失败时自动尝试翻转 v 前缀
download_compose_file() {
  local url="$1"
  local output="$2"
  local alt_version

  echo "📡 下载配置文件..."
  if curl -fsSL -o "$output" "$url" 2>/dev/null && [[ -s "$output" ]] && ! grep -q "Not Found" "$output" 2>/dev/null; then
    return 0
  fi

  # 第一次失败，尝试翻转 v 前缀
  alt_version=$(toggle_v_prefix "$CURRENT_VERSION")
  if [[ "$alt_version" != "$CURRENT_VERSION" ]]; then
    echo "⚠️  切换版本格式重试：$alt_version"
    set_compose_urls_by_version "$alt_version"
    url=$(get_docker_compose_url)
    if curl -fsSL -o "$output" "$url" 2>/dev/null && [[ -s "$output" ]] && ! grep -q "Not Found" "$output" 2>/dev/null; then
      CURRENT_VERSION="$alt_version"
      return 0
    fi
  fi

  return 1
}

# 全局下载地址配置（默认获取最新版本；也可用 VERSION=... 覆盖）
RESOLVED_VERSION=$(resolve_version) || exit 1
set_compose_urls_by_version "$RESOLVED_VERSION"



# 根据IPv6支持情况选择docker-compose URL
get_docker_compose_url() {
  if check_ipv6_support > /dev/null 2>&1; then
    echo "$DOCKER_COMPOSEV6_URL"
  else
    echo "$DOCKER_COMPOSEV4_URL"
  fi
}

# 检查 docker-compose 或 docker compose 命令
check_docker() {
  if command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
  elif command -v docker &> /dev/null; then
    if docker compose version &> /dev/null; then
      DOCKER_CMD="docker compose"
    else
      echo "错误：检测到 docker，但不支持 'docker compose' 命令。请安装 docker-compose 或更新 docker 版本。"
      exit 1
    fi
  else
    echo "错误：未检测到 docker 或 docker-compose 命令。请先安装 Docker。"
    exit 1
  fi
  echo "检测到 Docker 命令：$DOCKER_CMD"
}

# 检测系统是否支持 IPv6
check_ipv6_support() {
  echo "🔍 检测 IPv6 支持..."

  # 检查是否有 IPv6 地址（排除 link-local 地址）
  if ip -6 addr show | grep -v "scope link" | grep -q "inet6"; then
    echo "✅ 检测到系统支持 IPv6"
    return 0
  elif ifconfig 2>/dev/null | grep -v "fe80:" | grep -q "inet6"; then
    echo "✅ 检测到系统支持 IPv6"
    return 0
  else
    echo "⚠️ 未检测到 IPv6 支持"
    return 1
  fi
}



# 配置 Docker 启用 IPv6
configure_docker_ipv6() {
  echo "🔧 配置 Docker IPv6 支持..."

  # 检查操作系统类型
  OS_TYPE=$(uname -s)

  if [[ "$OS_TYPE" == "Darwin" ]]; then
    # macOS 上 Docker Desktop 已默认支持 IPv6
    echo "✅ macOS Docker Desktop 默认支持 IPv6"
    return 0
  fi

  # Docker daemon 配置文件路径
  DOCKER_CONFIG="/etc/docker/daemon.json"

  # 检查是否需要 sudo
  if [[ $EUID -ne 0 ]]; then
    SUDO_CMD="sudo"
  else
    SUDO_CMD=""
  fi

  # 检查 Docker 配置文件
  if [ -f "$DOCKER_CONFIG" ]; then
    # 检查是否已经配置了 IPv6
    if grep -q '"ipv6"' "$DOCKER_CONFIG"; then
      echo "✅ Docker 已配置 IPv6 支持"
    else
      echo "📝 更新 Docker 配置以启用 IPv6..."
      # 备份原配置
      $SUDO_CMD cp "$DOCKER_CONFIG" "${DOCKER_CONFIG}.backup"

      # 使用 jq 或 sed 添加 IPv6 配置
      if command -v jq &> /dev/null; then
        $SUDO_CMD jq '. + {"ipv6": true, "fixed-cidr-v6": "fd00::/80"}' "$DOCKER_CONFIG" > /tmp/daemon.json && $SUDO_CMD mv /tmp/daemon.json "$DOCKER_CONFIG"
      else
        # 如果没有 jq，使用 sed
        $SUDO_CMD sed -i 's/^{$/{\n  "ipv6": true,\n  "fixed-cidr-v6": "fd00::\/80",/' "$DOCKER_CONFIG"
      fi

      echo "🔄 重启 Docker 服务..."
      if command -v systemctl &> /dev/null; then
        $SUDO_CMD systemctl restart docker
      elif command -v service &> /dev/null; then
        $SUDO_CMD service docker restart
      else
        echo "⚠️ 请手动重启 Docker 服务"
      fi
      sleep 5
    fi
  else
    # 创建新的配置文件
    echo "📝 创建 Docker 配置文件..."
    $SUDO_CMD mkdir -p /etc/docker
    echo '{
  "ipv6": true,
  "fixed-cidr-v6": "fd00::/80"
}' | $SUDO_CMD tee "$DOCKER_CONFIG" > /dev/null

    echo "🔄 重启 Docker 服务..."
    if command -v systemctl &> /dev/null; then
      $SUDO_CMD systemctl restart docker
    elif command -v service &> /dev/null; then
      $SUDO_CMD service docker restart
    else
      echo "⚠️ 请手动重启 Docker 服务"
    fi
    sleep 5
  fi
}

# 显示菜单
show_menu() {
  echo "==============================================="
  echo "          面板管理脚本"
  echo "==============================================="
  echo "请选择操作："
  echo "1. 安装面板"
  echo "2. 更新面板"
  echo "3. 卸载面板"
  echo "4. 备份数据"
  echo "5. 恢复数据"
  echo "6. 域名反代"
  echo "7. 退出"
  echo "==============================================="
}

generate_random() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c16
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file=$(mktemp)
  if [ -f "$file" ]; then
    awk -v k="$key" -v v="$value" '
      BEGIN { found=0 }
      $0 ~ ("^" k "=") { print k "=" v; found=1; next }
      { print }
      END { if (!found) print k "=" v }
    ' "$file" > "$tmp_file"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp_file"
  fi

  mv "$tmp_file" "$file"
}

get_env_var() {
  local key="$1"
  local file="${2:-.env}"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  grep -m1 "^${key}=" "$file" | cut -d= -f2-
}

get_current_db_type() {
  local db_type database_url

  db_type=$(get_env_var "DB_TYPE")
  database_url=$(get_env_var "DATABASE_URL")

  if [[ "$db_type" == "sqlite" ]]; then
    echo "sqlite"
  elif [[ "$db_type" == "postgres" || "$database_url" == postgres://* || "$database_url" == postgresql://* ]]; then
    echo "postgres"
  else
    echo "sqlite"
  fi
}

wait_for_postgres_healthy() {
  local pg_health

  echo "🔍 检查 PostgreSQL 服务状态..."
  for i in {1..90}; do
    if docker ps --format "{{.Names}}" | grep -q "^flvx-svc-postgres$"; then
      pg_health=$(docker inspect -f '{{.State.Health.Status}}' flvx-svc-postgres 2>/dev/null || echo "unknown")
      if [[ "$pg_health" == "healthy" ]]; then
        echo "✅ PostgreSQL 服务健康检查通过"
        return 0
      elif [[ "$pg_health" == "unhealthy" ]]; then
        echo "⚠️ PostgreSQL 健康状态：$pg_health"
      fi
    else
      pg_health="not_running"
    fi

    if [ $i -eq 90 ]; then
      echo "❌ PostgreSQL 启动超时（90秒）"
      echo "🔍 当前状态：$(docker inspect -f '{{.State.Health.Status}}' flvx-svc-postgres 2>/dev/null || echo '容器不存在')"
      return 1
    fi

    if [ $((i % 15)) -eq 1 ]; then
      echo "⏳ 等待 PostgreSQL 启动... ($i/90) 状态：${pg_health:-unknown}"
    fi
    sleep 1
  done
}

wait_for_backend_healthy() {
  local backend_health

  echo "🔍 检查后端服务状态..."
  for i in {1..90}; do
    if docker ps --format "{{.Names}}" | grep -q "^flvx-svc-backend$"; then
      backend_health=$(docker inspect -f '{{.State.Health.Status}}' flvx-svc-backend 2>/dev/null || echo "unknown")
      if [[ "$backend_health" == "healthy" ]]; then
        echo "✅ 后端服务健康检查通过"
        return 0
      elif [[ "$backend_health" == "unhealthy" ]]; then
        echo "⚠️ 后端健康状态：$backend_health"
      fi
    else
      backend_health="not_running"
    fi

    if [ $i -eq 90 ]; then
      echo "❌ 后端服务启动超时（90秒）"
      echo "🔍 当前状态：$(docker inspect -f '{{.State.Health.Status}}' flvx-svc-backend 2>/dev/null || echo '容器不存在')"
      return 1
    fi

    if [ $((i % 15)) -eq 1 ]; then
      echo "⏳ 等待后端服务启动... ($i/90) 状态：${backend_health:-unknown}"
    fi
    sleep 1
  done
}

# 删除脚本自身
# delete_self() {
#   echo ""
#   echo "🗑️ 操作已完成，正在清理脚本文件..."
#   SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
#   sleep 1
#   rm -f "$SCRIPT_PATH" && echo "✅ 脚本文件已删除" || echo "❌ 删除脚本文件失败"
# }



# 获取用户输入的配置参数
get_config_params() {
  echo "🔧 请输入配置参数："

  read -p "前端端口（默认 63666）: " FRONTEND_PORT
  FRONTEND_PORT=${FRONTEND_PORT:-63666}

  read -p "后端端口（默认 63665）: " BACKEND_PORT
  BACKEND_PORT=${BACKEND_PORT:-63665}

  POSTGRES_DB="flvx_svc"
  POSTGRES_USER="flvx_svc"
  POSTGRES_PASSWORD=$(generate_random)

  # 固定使用 SQLite
  DB_TYPE="sqlite"
  DATABASE_URL=""

  # 生成 JWT 密钥
  JWT_SECRET=$(generate_random)
  
  # 授权服务配置（可选，跳过后可在面板设置中输入）
  echo ""
  echo "🔐 授权服务配置："
  read -p "授权码 UUID [留空可跳过，稍后在面板中配置]: " LICENSE_KEY
  
  # 如果填了授权码，则必须填写面板域名
  if [[ -n "$LICENSE_KEY" ]]; then
    read -p "面板域名（必填，用于授权验证）: " SERVER_DOMAIN
    while [[ -z "$SERVER_DOMAIN" ]]; do
      echo "❌ 面板域名不能为空，请重新输入"
      read -p "面板域名（必填，用于授权验证）: " SERVER_DOMAIN
    done
    # 自动去除 http:// 或 https:// 前缀和路径
    SERVER_DOMAIN=$(echo "$SERVER_DOMAIN" | sed -e 's|^[[:space:]]*||' -e 's|[[:space:]]*$||' -e 's|^https\?://||' -e 's|/.*||')
    echo "✅ 授权配置完成"
  else
    LICENSE_KEY=""
    SERVER_DOMAIN=""
    echo "⏭️  已跳过授权配置，安装后可在 设置 > 配置 中输入授权码"
  fi
}

# 安装功能
install_panel() {
  echo "🚀 开始安装面板..."
  
  # 创建安装目录
  INSTALL_DIR="/opt/flvx-svc"
  echo "📁 创建安装目录：$INSTALL_DIR"
  $SUDO_CMD mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  
  check_docker
  get_config_params

  echo "🔽 下载必要文件..."
  DOCKER_COMPOSE_URL=$(get_docker_compose_url)
  if download_compose_file "$DOCKER_COMPOSE_URL" docker-compose.yml; then
    echo "✅ 文件准备完成"
  else
    echo "❌ 配置文件下载失败，请检查版本号是否正确"
    return 1
  fi

  # 自动检测并配置 IPv6 支持
  if check_ipv6_support; then
    echo "🚀 系统支持 IPv6，自动启用 IPv6 配置..."
    configure_docker_ipv6
  fi

  cat > .env <<EOF
JWT_SECRET=$JWT_SECRET
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT
FLUX_VERSION=$CURRENT_VERSION

DB_TYPE=$DB_TYPE
DATABASE_URL=$DATABASE_URL

POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# 授权服务配置
LICENSE_SERVER_URL=https://sq.abai.eu.org
LICENSE_KEY=$LICENSE_KEY
SERVER_DOMAIN=$SERVER_DOMAIN
HMAC_SECRET_KEY=${HMAC_SECRET_KEY:-flvx_455f08ea-ce13-46d4-8574-ebd2a9d0e853}
EOF

  echo "🚀 启动 docker 服务..."
  if [[ "$DB_TYPE" == "postgres" ]]; then
    $DOCKER_CMD up -d postgres
    wait_for_postgres_healthy
    $DOCKER_CMD up -d backend frontend
  else
    $DOCKER_CMD up -d backend frontend
  fi

  echo "🎉 部署完成"
  echo ""
  echo "📋 登录信息："
  echo "   访问地址：http://服务器 IP:$FRONTEND_PORT"
  echo "   用户名：admin_user"
  echo "   密码：admin_user"
  echo ""
  echo "📚 文档地址：https://tes.cc/guide.html"
  echo "⚠️  请妥善保管管理员密码！"


}

# 更新功能
update_panel() {
  echo "🔄 开始更新面板..."
  
  # 切换到安装目录
  INSTALL_DIR="/opt/flvx-svc"
  
  # 检测目录是否存在，不存在则先创建
  if [[ ! -d "$INSTALL_DIR" ]]; then
    echo "📁 升级目录不存在，正在创建：$INSTALL_DIR"
    $SUDO_CMD mkdir -p "$INSTALL_DIR"
  fi
  
  cd "$INSTALL_DIR"
  
  check_docker

  if [[ ! -f ".env" ]]; then
    echo "⚠️ 未找到 .env，默认按 SQLite 模式更新"
  fi
  CURRENT_DB_TYPE=$(get_current_db_type)
  echo "🗄️ 当前数据库类型：$CURRENT_DB_TYPE"

  # 备份数据库（仅 SQLite）
  if [[ "$CURRENT_DB_TYPE" == "sqlite" ]]; then
    echo "💾 正在备份 SQLite 数据库..."
    mkdir -p /root/flvxbackup
    if docker cp flvx-svc-backend:/app/data/gost.db /root/flvxbackup/gost.db.bak; then
      echo "✅ 数据库备份成功"
    else
      echo "⚠️ 数据库备份失败，请检查容器是否运行"
    fi
  fi

  if [[ -n "$ARG_VERSION" ]]; then
    UPDATE_VERSION="$ARG_VERSION"
    echo "🆕 指定版本：$UPDATE_VERSION"
  else
    echo "🔍 获取最新版本号..."
    UPDATE_VERSION=$(resolve_latest_release_tag) || {
      echo "❌ 无法获取最新版本号，更新终止"
      return 1
    }
    echo "🆕 最新版本：$UPDATE_VERSION"
  fi
  set_compose_urls_by_version "$UPDATE_VERSION"

  echo "🔽 下载最新配置文件..."
  DOCKER_COMPOSE_URL=$(get_docker_compose_url)
  if download_compose_file "$DOCKER_COMPOSE_URL" docker-compose.yml; then
    echo "✅ 下载完成"
  else
    echo "❌ 配置文件下载失败，请检查版本号是否正确"
    return 1
  fi
  upsert_env_var ".env" "FLUX_VERSION" "$CURRENT_VERSION"

  # 自动检测并配置 IPv6 支持
  if check_ipv6_support; then
    echo "🚀 系统支持 IPv6，自动启用 IPv6 配置..."
    configure_docker_ipv6
  fi

  # 先发送 SIGTERM 信号，让应用优雅关闭
  docker stop -t 30 flvx-svc-backend 2>/dev/null || true
  docker stop -t 10 flvx-svc-frontend 2>/dev/null || true
  
  # 等待 WAL 文件同步
  echo "⏳ 等待数据同步..."
  sleep 5
  
  # 然后再完全停止
  $DOCKER_CMD down

  echo "⬇️ 拉取最新镜像..."
  if [[ "$CURRENT_DB_TYPE" == "postgres" ]]; then
    $DOCKER_CMD pull backend frontend postgres
  else
    $DOCKER_CMD pull backend frontend
  fi

  echo "🚀 启动更新后的服务..."
  if [[ "$CURRENT_DB_TYPE" == "postgres" ]]; then
    $DOCKER_CMD up -d postgres
    wait_for_postgres_healthy
    $DOCKER_CMD up -d backend frontend
  else
    $DOCKER_CMD up -d backend frontend
  fi

  # 等待服务启动
  echo "⏳ 等待服务启动..."

  if ! wait_for_backend_healthy; then
    echo "🛑 更新终止"
    return 1
  fi

  echo "⏳ 准备清理旧版本镜像..."
  sleep 10
  
  # 解决 Nerdctl/Docker 格式不兼容以及 $1 提取错误 (如 Tag 和 ID 粘连) 的问题
  # 使用正则提取标准镜像格式：ghcr.io/abai569/<名称>:<版本>
  # 排除当前最新版本 $LATEST_VERSION
  OLD_IMAGES=$(docker images 2>/dev/null | grep -v "WARNING" | grep -oE 'ghcr.io/abai569/[^:]+:[^[:space:]":]+' | grep -v ":${LATEST_VERSION}$" | sort -u)
  
  if [ -n "$OLD_IMAGES" ]; then
    echo " 发现旧版本面板镜像，正在强制删除："
    echo "$OLD_IMAGES"
    echo "$OLD_IMAGES" | xargs docker rmi -f >/dev/null 2>&1 || true
    echo "✅ 旧版本面板镜像清理完毕"
  else
    echo "✨ 没有需要清理的旧版本面板镜像"
  fi

  # 显示备份信息
  if [[ "$CURRENT_DB_TYPE" == "sqlite" && -f "/root/flvxbackup/gost.db.bak" ]]; then
    BACKUP_SIZE=$(ls -lh /root/flvxbackup/gost.db.bak | awk '{print $5}')
    echo ""
    echo " 备份信息："
    echo "   备份目录：/root/flvxbackup/"
    echo "   备份文件：gost.db.bak ($BACKUP_SIZE)"
  fi

  echo "✅ 更新完成"
}


migrate_to_postgres() {
  local current_db_type postgres_db postgres_user postgres_password database_url

  echo "🔄 开始迁移 SQLite -> PostgreSQL..."
  check_docker

  if [[ ! -f ".env" ]]; then
    echo "❌ 未找到 .env 文件，请先安装面板"
    return 1
  fi

  if [[ ! -f "docker-compose.yml" ]]; then
    echo "⚠️ 未找到 docker-compose.yml 文件，正在下载..."
    DOCKER_COMPOSE_URL=$(get_docker_compose_url)
    echo "📡 选择配置文件：$(basename "$DOCKER_COMPOSE_URL")"
    curl -L -o docker-compose.yml "$DOCKER_COMPOSE_URL"
    echo "✅ docker-compose.yml 下载完成"
  fi

  current_db_type=$(get_current_db_type)
  if [[ "$current_db_type" == "postgres" ]]; then
    echo "ℹ️ 当前已使用 PostgreSQL，无需迁移"
    return 0
  fi

  postgres_db=$(get_env_var "POSTGRES_DB")
  postgres_user=$(get_env_var "POSTGRES_USER")
  postgres_password=$(get_env_var "POSTGRES_PASSWORD")

  postgres_db=${postgres_db:-flvx_svc}
  postgres_user=${postgres_user:-flvx_svc}
  postgres_password=${postgres_password:-$(generate_random)}

  upsert_env_var ".env" "POSTGRES_DB" "$postgres_db"
  upsert_env_var ".env" "POSTGRES_USER" "$postgres_user"
  upsert_env_var ".env" "POSTGRES_PASSWORD" "$postgres_password"

  echo "🛑 停止当前服务..."
  docker stop -t 30 flvx-svc-backend 2>/dev/null || true
  docker stop -t 10 flvx-svc-frontend 2>/dev/null || true
  echo "⏳ 等待数据同步..."
  sleep 5
  $DOCKER_CMD down

  echo "💾 备份 SQLite 数据到当前目录..."
  if ! docker run --rm -v sqlite_data:/data -v "$(pwd)":/backup alpine sh -c "cp /data/gost.db /backup/gost.db.bak"; then
    echo "❌ SQLite 备份失败，迁移终止"
    return 1
  fi

  echo "🚀 启动 PostgreSQL..."
  $DOCKER_CMD up -d postgres
  if ! wait_for_postgres_healthy; then
    echo "🛑 PostgreSQL 未就绪，迁移终止"
    return 1
  fi

  echo "🔄 执行 pgloader 迁移..."
  if ! docker run --rm --network gost-network -v sqlite_data:/sqlite dimitri/pgloader:latest pgloader /sqlite/gost.db "postgresql://${postgres_user}:${postgres_password}@postgres:5432/${postgres_db}"; then
    echo "❌ pgloader 迁移失败，迁移终止（如报 28P01，可执行 docker volume rm postgres_data 后重试）"
    return 1
  fi

  database_url="postgresql://${postgres_user}:${postgres_password}@postgres:5432/${postgres_db}?sslmode=disable"
  upsert_env_var ".env" "DB_TYPE" "postgres"
  upsert_env_var ".env" "DATABASE_URL" "$database_url"

  echo "🚀 启动迁移后的服务..."
  $DOCKER_CMD up -d postgres backend frontend

  echo "⏳ 等待服务启动..."
  if ! wait_for_backend_healthy; then
    echo "🛑 迁移后服务启动失败"
    return 1
  fi

  echo "✅ SQLite -> PostgreSQL 迁移完成"
}



# 备份面板数据
backup_panel_data() {
  local install_dir backup_base timestamp backup_dir current_db_type
  local postgres_user postgres_db backup_size

  echo "📦 开始备份面板数据..."

  install_dir="/opt/flvx-svc"
  backup_base="/root/flvxbackup"

  if [[ ! -d "$install_dir" ]]; then
    echo "❌ 未检测到面板安装（/opt/flvx-svc 不存在），请先安装面板"
    return 1
  fi

  cd "$install_dir"
  check_docker

  timestamp=$(date +"%Y%m%d_%H%M%S")
  backup_dir="${backup_base}/flvx_backup_${timestamp}"
  mkdir -p "$backup_dir"

  # 备份配置文件
  echo "📋 备份配置文件..."
  if [[ -f ".env" ]]; then
    cp .env "$backup_dir/.env"
    echo "  .env → 已备份"
  fi

  # 检测数据库类型并备份
  current_db_type=$(get_current_db_type)
  echo "🗄️ 当前数据库类型：$current_db_type"

  if [[ "$current_db_type" == "sqlite" ]]; then
    echo "📦 备份 SQLite 数据库（在线热备）..."
    if docker cp flvx-svc-backend:/app/data/gost.db "$backup_dir/gost.db" 2>/dev/null; then
      echo "  gost.db → 已备份"
    else
      echo "❌ SQLite 数据库备份失败，请检查容器是否运行"
      return 1
    fi

  elif [[ "$current_db_type" == "postgres" ]]; then
    postgres_user=$(get_env_var "POSTGRES_USER")
    postgres_db=$(get_env_var "POSTGRES_DB")
    postgres_user=${postgres_user:-flvx_svc}
    postgres_db=${postgres_db:-flvx_svc}

    echo "📦 备份 PostgreSQL 数据库（在线热备）..."
    if docker exec flvx-svc-postgres pg_dump -U "$postgres_user" -d "$postgres_db" > "$backup_dir/backup.sql" 2>/dev/null; then
      echo "  backup.sql → 已备份"
    else
      echo "❌ PostgreSQL 数据库备份失败，请检查容器是否运行"
      return 1
    fi
  fi

  # 计算备份大小
  backup_size=$(du -sh "$backup_dir" | cut -f1)

  echo ""
  echo "==============================================="
  echo "              备份完成"
  echo "==============================================="
  echo "📁 备份目录：$backup_dir"
  echo "📊 备份大小：$backup_size"
  echo ""
  echo "📄 备份文件列表："
  ls -lhA "$backup_dir"
  echo ""
  echo "⚠️  重要提示："
  echo "   请立即下载备份文件到本地电脑安全保存！"
  echo "   以防服务器数据丢失或损坏。"
  echo ""
  echo "   💡 推荐下载方式："
  echo "     使用 FinalShell / WinSCP等工具连接服务器后下载到本地"
  echo "==============================================="

  # 清理旧备份，只保留最近5次
  echo ""
  echo "🧹 清理旧备份（保留最近5次）..."
  local backup_count
  backup_count=$(ls -1d "${backup_base}"/flvx_backup_* 2>/dev/null | wc -l)
  if [[ "$backup_count" -gt 5 ]]; then
    local to_delete=$((backup_count - 5))
    ls -1d "${backup_base}"/flvx_backup_* | head -n "$to_delete" | while read -r old_backup; do
      rm -rf "$old_backup"
      echo "  已删除旧备份：$(basename "$old_backup")"
    done
    echo "✅ 已清理 $to_delete 个旧备份"
  else
    echo "✅ 当前备份数量：$backup_count / 5（无需清理）"
  fi
}


# 恢复面板数据
restore_panel_data() {
  local install_dir backup_base current_db_type backup_choice backup_dir
  local postgres_user postgres_db postgres_password

  echo "📥 开始恢复面板数据..."

  install_dir="/opt/flvx-svc"
  backup_base="/root/flvxbackup"

  if [[ ! -d "$install_dir" ]]; then
    echo "❌ 未检测到面板安装（/opt/flvx-svc 不存在），请先安装面板"
    return 1
  fi

  # 检查是否有可用备份
  if ! ls -1d "${backup_base}"/flvx_backup_* &>/dev/null; then
    echo "❌ 未找到任何备份文件，请先执行备份操作"
    return 1
  fi

  cd "$install_dir"
  check_docker

  # 列出所有备份供选择
  echo ""
  echo "📂 可用备份列表："
  echo "==============================================="
  local backups=()
  local idx=1
  while IFS= read -r dir; do
    backups+=("$dir")
    local bname
    bname=$(basename "$dir")
    local bsize
    bsize=$(du -sh "$dir" 2>/dev/null | cut -f1)
    echo "  $idx. $bname ($bsize)"
    idx=$((idx + 1))
  done < <(ls -1d "${backup_base}"/flvx_backup_* | sort -r)
  echo "==============================================="

  if [[ "$idx" -eq 1 ]]; then
    echo ""
    echo "❌ 未找到备份文件"
    echo ""
    echo "💡 换机恢复操作指南："
    echo "   1. 在新服务器正常运行此脚本，先完成面板安装"
    echo "   2. 将旧服务器备份的文件夹上传至新服务器："
    echo "        /root/flvxbackup/ 自行创建目录"
    echo "   3. 重新运行此脚本，选择 '5. 恢复数据' 即可"
    echo ""
    echo "   上传方式："
    echo "     使用 FinalShell / WinSCP 等工具上传文件夹到上述路径"
    echo "==============================================="
    return 1
  fi

  read -p "请选择要恢复的备份编号 (1-$((idx-1)))，回车默认 1 最新备份或输入 q 取消: " backup_choice

  if [[ "$backup_choice" == "q" || "$backup_choice" == "Q" ]]; then
    echo "❌ 取消恢复操作"
    return 0
  fi

  backup_choice=${backup_choice:-1}

  if ! [[ "$backup_choice" =~ ^[0-9]+$ ]] || [[ "$backup_choice" -lt 1 ]] || [[ "$backup_choice" -gt $((idx-1)) ]]; then
    echo "❌ 无效的选择"
    return 1
  fi

  backup_dir="${backups[$((backup_choice-1))]}"
  echo "📁 选择备份：$(basename "$backup_dir")"

  # 确认恢复
  echo ""
  echo "⚠️  警告：恢复操作将覆盖当前数据库数据！"
  read -p "确认继续恢复吗？回车默认恢复或输入 N 跳过: " confirm
  if [[ "$confirm" == "n" || "$confirm" == "N" ]]; then
    echo "❌ 取消恢复操作"
    return 0
  fi

  # 停止后端服务
  echo "🛑 停止后端服务..."
  docker stop -t 30 flvx-svc-backend 2>/dev/null || true
  sleep 3

  # 检测数据库类型并恢复
  current_db_type=$(get_current_db_type)
  echo "🗄️ 当前数据库类型：$current_db_type"

  if [[ "$current_db_type" == "sqlite" ]]; then
    if [[ -f "$backup_dir/gost.db" ]]; then
      echo "📦 恢复 SQLite 数据库..."
      if docker cp "$backup_dir/gost.db" flvx-svc-backend:/app/data/gost.db 2>/dev/null; then
        echo "  gost.db → 已恢复"
      else
        echo "❌ SQLite 数据库恢复失败"
        return 1
      fi
    else
      echo "❌ 备份中未找到 gost.db 文件"
      return 1
    fi

  elif [[ "$current_db_type" == "postgres" ]]; then
    if [[ -f "$backup_dir/backup.sql" ]]; then
      postgres_user=$(get_env_var "POSTGRES_USER")
      postgres_db=$(get_env_var "POSTGRES_DB")
      postgres_password=$(get_env_var "POSTGRES_PASSWORD")
      postgres_user=${postgres_user:-flvx_svc}
      postgres_db=${postgres_db:-flvx_svc}

      echo "📦 恢复 PostgreSQL 数据库..."
      if docker exec -i flvx-svc-postgres psql -U "$postgres_user" -d "$postgres_db" < "$backup_dir/backup.sql" 2>/dev/null; then
        echo "  backup.sql → 已恢复"
      else
        echo "❌ PostgreSQL 数据库恢复失败"
        return 1
      fi
    else
      echo "❌ 备份中未找到 backup.sql 文件"
      return 1
    fi
  fi

  # 恢复配置文件（包含授权信息）
  if [[ -f "$backup_dir/.env" ]]; then
    echo ""
    echo "📋 检测到备份中包含 .env 配置文件(包含授权信息)"
    read -p "是否同时恢复 .env 配置文件？回车默认恢复或输入 N 跳过: " restore_env
    if [[ "$restore_env" != "n" && "$restore_env" != "N" ]]; then
      cp "$backup_dir/.env" "$install_dir/.env"
      echo "  .env → 已恢复"
    fi
  fi

  # 重启服务
  echo ""
  echo "🚀 重启后端服务..."
  $DOCKER_CMD up -d backend

  echo "⏳ 等待服务启动..."
  if wait_for_backend_healthy; then
    echo ""
    echo "==============================================="
    echo "              恢复完成"
    echo "==============================================="
    echo "✅ 数据已从备份恢复并重启服务"
    echo "📁 恢复来源：$(basename "$backup_dir")"
    echo "==============================================="
  else
    echo "❌ 服务启动失败，请检查日志"
    return 1
  fi
}


# 卸载功能
uninstall_panel() {
  local non_interactive="${1:-false}"
  echo "🗑️ 开始卸载面板..."
  
  # 切换到安装目录
  INSTALL_DIR="/opt/flvx-svc"
  
  # 检测目录是否存在，不存在则先创建
  if [[ ! -d "$INSTALL_DIR" ]]; then
    echo "📁 升级目录不存在，正在创建：$INSTALL_DIR"
    $SUDO_CMD mkdir -p "$INSTALL_DIR"
  fi
  
  cd "$INSTALL_DIR"
  
  check_docker

  if [[ ! -f "docker-compose.yml" ]]; then
    echo "⚠️ 未找到 docker-compose.yml 文件，正在下载以完成卸载..."
    DOCKER_COMPOSE_URL=$(get_docker_compose_url)
    echo "📡 选择配置文件：$(basename "$DOCKER_COMPOSE_URL")"
    curl -L -o docker-compose.yml "$DOCKER_COMPOSE_URL"
    echo "✅ docker-compose.yml 下载完成"
  fi

  if [[ "$non_interactive" != "true" ]]; then
    read -p "确认卸载面板吗？此操作将停止并删除所有容器和数据 (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      echo "❌ 取消卸载"
      return 0
    fi
  else
    echo "🔶 无交互模式：自动确认卸载"
  fi

  echo "🛑 停止并删除容器、镜像、卷..."
  $DOCKER_CMD down --rmi all --volumes --remove-orphans
  echo "🧹 删除配置文件..."
  rm -f docker-compose.yml .env
  echo "✅ 卸载完成"
}

setup_caddy() {
  local domain="$1"
  local port="$2"

  echo "🚀 正在安装并配置 Caddy 服务 (域名: $domain)..."

  # 1. 检查环境
  if ! command -v apt-get &> /dev/null; then
    echo "❌ 当前系统不支持自动安装 Caddy (仅支持 Debian/Ubuntu)."
    echo "⚠️ 请手动安装 Caddy 并反向代理至 http://127.0.0.1:$port"
    return 1
  fi

  # 2. 安装 Caddy
  if ! command -v caddy &> /dev/null; then
    echo "📦 未检测到 Caddy，正在添加源并安装..."
    sudo apt-get update
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudflare.com/content/v1/e2qwFJ2fRP2b2q/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudflare.com/content/v1/e2qwFJ2fRP2b2q/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update
    sudo apt-get install -y caddy
  else
    echo "✅ 检测到 Caddy 已安装"
  fi

  # 3. 配置 Caddyfile
  echo "📝 正在写入 Caddyfile 配置..."
  sudo tee /etc/caddy/Caddyfile > /dev/null <<CADDY_EOF
${domain} {
    reverse_proxy http://127.0.0.1:${port} {
        header_up Host {host}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }
}
CADDY_EOF

  # 4. 重启
  echo "🔄 重启 Caddy 服务..."
  sudo systemctl restart caddy
  echo "🎉 Caddy 配置成功，请通过 https://$domain 访问面板。"
  sleep 2
  return 0
}

configure_caddy_interactive() {
  local install_dir domain port

  install_dir="/opt/flvx-svc"

  if [[ ! -d "$install_dir" ]]; then
    echo "❌ 未检测到面板安装（/opt/flvx-svc 不存在），请先安装面板"
    return 1
  fi

  cd "$install_dir"

  if [[ ! -f ".env" ]]; then
    echo "❌ 未找到 .env 文件，请先安装面板"
    return 1
  fi

  port=$(get_env_var "FRONTEND_PORT")
  port=${port:-63666}

  echo " 配置 Caddy 反代"
  echo "📌 当前前端端口：$port"
  echo ""

  read -p "请输入绑定域名：" domain
  while [[ -z "$domain" ]]; do
    echo "❌ 域名不能为空，请重新输入"
    read -p "请输入绑定域名：" domain
  done

  if setup_caddy "$domain" "$port"; then
    echo ""
    echo "✅ Caddy 配置成功"
    echo "   访问地址：https://$domain"
  else
    echo "❌ Caddy 配置失败"
    return 1
  fi
}

# 主逻辑
main() {

  # 无交互卸载
  if [[ "$1" == "uninstall" ]]; then
    uninstall_panel "true"
    exit $?
  fi

  # 无参数 update 直接升级到最新版
  if [[ "$1" == "update" ]]; then
    echo "🔄 直接进入更新流程（最新版）..."
    if [[ ! -d "/opt/flvx-svc" ]]; then
      echo "❌ 未检测到面板安装，请先执行安装操作"
      exit 1
    fi
    ARG_VERSION=""
    update_panel
    exit $?
  fi

  # 指定版本时直接升级（无交互）
  if [[ -n "$ARG_VERSION" ]]; then
    echo "🔄 指定版本：$ARG_VERSION，直接进入更新流程..."
    if [[ ! -d "/opt/flvx-svc" ]]; then
      echo "❌ 未检测到面板安装，请先执行安装操作"
      exit 1
    fi
    update_panel
    exit $?
  fi

  # 显示交互式菜单
  while true; do
    show_menu
    read -p "请输入选项 (1-7): " choice

    case $choice in
      1)
        install_panel
        exit 0
        ;;
      2)
        update_panel
        exit 0
        ;;
      3)
        uninstall_panel
        exit 0
        ;;
      4)
        backup_panel_data
        echo ""
        ;;
      5)
        restore_panel_data
        echo ""
        ;;
      6)
        configure_caddy_interactive
        echo ""
        ;;
      7)
        echo "👋 退出脚本"
        exit 0
        ;;
      *)
        echo "❌ 无效选项，请输入 1-7"
        echo ""
        ;;
    esac
  done
}

# 执行主函数
main
