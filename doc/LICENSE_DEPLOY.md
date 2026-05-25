# FLVX 授权系统部署指南

## 概述

FLVX 采用正式授权模式，由两部分组成：

1. **FLVX Panel** (开源) - 流量转发管理系统
2. **License Server** (私有) - 授权生成和管理服务器

## 架构说明

```
┌─────────────────────────────────────┐
│   License Server (私有部署)          │
│   - RSA-2048 签名生成 License        │
│   - License 管理后台                 │
│   - 客户数据库                       │
│                                     │
│   部署位置：您的私有服务器            │
│   访问地址：https://license.yourdomain.com
└─────────────────────────────────────┘
              │
              │ License Key
              ▼
┌─────────────────────────────────────┐
│   FLVX Panel (开源)                 │
│   - License 验证（公钥）            │
│   - 域名绑定检查                    │
│   - 过期控制                        │
│                                     │
│   部署位置：客户服务器               │
│   访问地址：https://panel.customer.com
└─────────────────────────────────────┘
```

## 第一部分：部署 License Server（私有）

### 系统要求

- CPU: 1 核
- 内存：512MB
- 存储：1GB
- 系统：Ubuntu 22.04 / Debian 12
- 网络：可访问互联网

### 部署步骤

#### 1. 准备服务器

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 安装 Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

#### 2. 获取 License Server 代码

⚠️ **注意**: License Server 代码不公开，需要通过私有渠道获取。

```bash
# 方式 A: 从私有仓库克隆
git clone git@github.com:your-org/flvx-license-server.git
cd flvx-license-server

# 方式 B: 使用提供的构建包
# 下载 license-server-release.tar.gz
tar -xzf license-server-release.tar.gz
cd license-server
```

#### 3. 配置 Docker Compose

```bash
cat > docker-compose.yml <<EOF
version: '3.8'

services:
  license-server:
    image: license-server:latest
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - ADMIN_TOKEN=your-secret-admin-token
    restart: unless-stopped
EOF
```

#### 4. 启动服务

```bash
docker-compose up -d
```

#### 5. 配置 Nginx 反向代理（推荐）

```bash
cat > /etc/nginx/sites-available/license <<EOF
server {
    listen 80;
    server_name license.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

ln -s /etc/nginx/sites-available/license /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# 申请 HTTPS 证书
certbot --nginx -d license.yourdomain.com
```

#### 6. 验证部署

```bash
# 访问管理界面
curl https://license.yourdomain.com

# 查看统计信息
curl -H "X-Admin-Token: your-secret-admin-token" \
     https://license.yourdomain.com/api/v1/stats
```

### 生成 License

1. 访问 https://license.yourdomain.com
2. 输入客户域名（如：panel.customer.com）
3. 选择授权时长（1-12 个月）
4. 点击"生成 License"
5. 下载 license.json 或复制 License Key

### 安全管理

⚠️ **重要安全建议**:

1. **保护私钥**
   - config/private_key.pem 是核心资产
   - 定期备份到安全位置
   - 永不上传到任何公开仓库

2. **设置强 Admin Token**
   ```bash
   # 生成随机 token
   openssl rand -hex 32
   ```

3. **限制访问 IP**
   ```nginx
   # Nginx 配置
   allow 1.2.3.4;  # 只允许特定 IP
   deny all;
   ```

4. **定期轮换密钥**
   - 建议每 6-12 个月轮换 RSA 密钥
   - 轮换后需要更新所有面板的公钥

---

## 第二部分：部署 FLVX Panel（公开）

### 快速部署

```bash
# 面板端
curl -L https://raw.githubusercontent.com/abai569/flvx/main/panel_install.sh -o panel_install.sh && chmod +x panel_install.sh && ./panel_install.sh

# 节点端
curl -L https://raw.githubusercontent.com/abai569/flvx/main/install.sh -o install.sh && chmod +x install.sh && ./install.sh
```

### 配置 License 验证

面板默认集成 License 验证功能，无需额外配置。

#### 激活 License

1. 访问面板 https://panel.customer.com
2. 登录后进入 `/license` 页面
3. 输入 License Key
4. 点击"激活授权"

#### 验证流程

面板会验证：
- ✅ RSA 签名有效性（使用内置公钥）
- ✅ 域名匹配（当前访问域名）
- ✅ 是否在有效期内

---

## 第三部分：授权分发流程

### 完整流程

1. **客户购买授权**
   - 选择授权等级（标准版/专业版/企业版）
   - 提供面板域名

2. **生成 License**
   - 访问 License Server
   - 输入客户域名
   - 选择时长
   - 生成 License

3. **发送给客户**
   ```
   感谢您的购买！
   
   License 信息:
   - 绑定域名：panel.customer.com
   - 授权时长：3 个月
   - 过期时间：2026-07-16
   
   License Key:
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
   
   激活步骤:
   1. 访问面板 /license 页面
   2. 粘贴 License Key
   3. 点击"激活授权"
   ```

4. **客户激活**
   - 客户在面板导入 License
   - 自动验证并激活
   - 开始使用

---

## 第四部分：日常管理

### 查看统计

```bash
curl -H "X-Admin-Token: your-token" \
     https://license.yourdomain.com/api/v1/stats
```

返回：
```json
{
  "stats": {
    "total": 100,
    "active": 85,
    "revoked": 15
  }
}
```

### 吊销 License

对于违规用户：

```bash
curl -X POST -H "X-Admin-Token: your-token" \
     "https://license.yourdomain.com/api/v1/revoke?id=1"
```

### 轮换密钥

```bash
# 1. 备份旧密钥
cp config/private_key.pem config/private_key.pem.bak.$(date +%Y%m%d)

# 2. 删除旧密钥（重启自动生成）
rm config/private_key.pem
docker-compose restart

# 3. 获取新公钥
curl https://license.yourdomain.com/api/v1/public-key

# 4. 更新面板代码中的公钥
# 编辑 go-backend/internal/http/handler/license_handler.go
# 替换 DefaultPublicKeyPEM 常量

# 5. 重新构建并部署面板
cd flvx/go-backend
make build
systemctl restart paneld
```

---

## 故障排查

### License Server 无法启动

```bash
# 查看日志
docker-compose logs license-server

# 检查端口
netstat -tlnp | grep 8080

# 检查权限
ls -la config/ data/
```

### License 验证失败

1. **检查域名匹配**
   - License 绑定域名必须与面板访问域名一致
   - 支持通配符：`*.example.com`

2. **检查时间同步**
   ```bash
   date
   # 确保服务器时间准确
   ```

3. **检查公钥配置**
   - 确保面板公钥与 License Server 匹配

---

## 技术支持

- 文档：https://docs.yourdomain.com
- 邮箱：support@yourdomain.com
- Telegram: https://t.me/flvxpanel
