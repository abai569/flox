# FLVX 授权系统架构说明

## 📌 重要提示

⚠️ **本文档说明 FLVX 授权系统的架构设计，请仔细阅读以确保安全部署。**

---

## 架构概述

FLVX 采用**分离式授权架构**，确保系统安全性的同时保持代码透明度：

```
┌─────────────────────────────────────────┐
│   License Server (私有部署)              │
│   ────────────────────────              │
│   包含:                                  │
│   - RSA 私钥（核心资产）                │
│   - License 生成逻辑                     │
│   - 签名算法                             │
│   - 管理后台                             │
│                                         │
│   部署位置：您的私有服务器               │
│   访问控制：严格限制访问 IP              │
│   源码状态：❌ 不公开                    │
└─────────────────────────────────────────┘
              │
              │ 生成 License Key
              ▼
┌─────────────────────────────────────────┐
│   FLVX Panel (开源)                      │
│   ──────────────────                    │
│   包含：                                 │
│   - RSA 公钥（用于验证）                │
│   - License 验证逻辑                     │
│   - 域名绑定检查                         │
│   - 过期控制                             │
│                                         │
│   部署位置：客户服务器                   │
│   访问控制：公开访问                     │
│   源码状态：✅ 开源                      │
└─────────────────────────────────────────┘
```

---

## 为什么采用这种架构？

### 安全性考虑

1. **私钥隔离**
   - RSA 私钥是授权系统的核心
   - 只有您能生成有效的 License
   - 即使面板代码公开，也无法伪造 License

2. **透明验证**
   - 面板使用公钥验证 License
   - 验证逻辑完全透明
   - 用户可以审计验证过程

3. **域名绑定**
   - 每个 License 绑定特定域名
   - 防止 License 被滥用
   - 支持通配符域名

### 商业模式

1. **控制分发**
   - 只有您能生成 License
   - 可以灵活设置授权等级
   - 支持试用版/标准版/专业版

2. **收入保障**
   - 无法破解 License
   - 过期自动停止服务
   - 支持吊销机制

3. **客户信任**
   - 面板代码开源透明
   - 验证逻辑可审计
   - 建立品牌信任

---

## 部署策略

### License Server（私有）

**部署位置选择:**

1. **您的私有服务器** (推荐)
   - 完全控制
   - 安全性最高
   - 需要自行维护

2. **云服务器** (推荐)
   - 阿里云/腾讯云/AWS
   - 配置安全组限制访问
   - 建议搭配 VPN 访问

3. **容器平台**
   - Kubernetes 集群
   - 自动扩缩容
   - 高可用部署

**安全建议:**

```bash
# 1. 防火墙限制
ufw allow from 1.2.3.4/32 to any port 8080

# 2. Nginx 访问控制
allow 1.2.3.4;
deny all;

# 3. 强 Admin Token
ADMIN_TOKEN=$(openssl rand -hex 32)

# 4. 定期备份私钥
tar -czf private_key_backup_$(date +%Y%m%d).tar.gz config/
```

### FLVX Panel（开源）

**GitHub 仓库结构:**

```
flvx/
├── go-backend/              # ✅ 后端（含 License 验证）
├── vite-frontend/           # ✅ 前端（授权管理界面）
├── doc/                     # ✅ 文档
├── docker-compose-*.yml     # ✅ 部署配置
├── panel_install.sh         # ✅ 安装脚本
├── LICENSE                  # ✅ 开源协议
└── README.md                # ✅ 项目说明

⚠️ 不包含:
❌ license-server/           # 私有部署
❌ scripts/license-gen/     # 签名工具
❌ config/private_key.pem   # 私钥文件
```

**.githubignore 配置:**

```gitignore
# 私有部署
license-server/
scripts/license-gen/

# 私钥和密钥
**/private_key.pem
**/*.pem
**/secret.key

# 数据库
data/
config/
```

---

## 工作流程

### 1. 生成 License

```
管理员 → License Server
       ↓
输入：客户域名 (panel.customer.com)
输入：授权时长 (3 个月)
       ↓
RSA-2048 私钥签名
       ↓
输出：License Key
       ↓
发送给客户
```

### 2. 激活 License

```
客户 → FLVX Panel
     ↓
输入：License Key
     ↓
验证流程:
1. Base64 解码
2. RSA 公钥验证签名 ✅
3. 检查域名匹配 ✅
4. 检查是否过期 ✅
     ↓
激活成功/失败
```

### 3. 运行时验证

```
每次 API 请求
     ↓
License 中间件检查
     ↓
- 是否已激活
- 是否过期
     ↓
通过 → 处理请求
拒绝 → 返回 403
```

---

## 密钥管理

### RSA 密钥对生成

```bash
# License Server 首次启动时自动生成
config/private_key.pem  # 私钥（永不公开）
```

### 公钥提取

```bash
# 从私钥提取公钥
openssl rsa -in private_key.pem -pubout -out public_key.pem

# 嵌入到面板代码中
# go-backend/internal/http/handler/license_handler.go
const DefaultPublicKeyPEM = `-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----`
```

### 密钥轮换

建议每 6-12 个月轮换一次：

```bash
# 1. 备份旧密钥
cp private_key.pem private_key.pem.bak.$(date +%Y%m%d)

# 2. 生成新密钥（删除旧的，重启自动生成）
rm private_key.pem
docker-compose restart

# 3. 提取新公钥
openssl rsa -in private_key.pem -pubout -out public_key.pem

# 4. 更新面板代码
# 编辑 license_handler.go，替换 DefaultPublicKeyPEM

# 5. 重新构建面板
cd go-backend
make build

# 6. 通知客户升级面板
```

---

## 常见问题

### Q: 为什么不把 License Server 也开源？

A: License Server 包含 RSA 私钥和签名逻辑，如果开源：
- ❌ 任何人都可以生成 License
- ❌ 授权系统完全失效
- ❌ 无法保障商业利益

### Q: 用户如何信任验证逻辑？

A: 面板代码完全开源：
- ✅ 验证逻辑透明可审计
- ✅ 使用标准 RSA 算法
- ✅ 公钥硬编码在代码中
- ✅ 用户可以审查每一行代码

### Q: 如果客户修改面板代码绕过验证？

A: 有几种防护方式：
1. **代码签名** - 验证二进制完整性
2. **在线验证** - 定期连接授权服务器
3. **功能限制** - 核心功能在后端
4. **法律约束** - 正式授权协议

### Q: 如何防止 License 被共享？

A: 多重防护：
1. **域名绑定** - License 只能用于特定域名
2. **IP 限制** - 可选限制服务器 IP
3. **在线验证** - 检查 License 状态
4. **吊销机制** - 可远程吊销 License

---

## 最佳实践

### 1. 保护私钥

```bash
# ✅ 正确做法
- 私钥保存在私有服务器
- 设置严格的文件权限 (chmod 600)
- 定期备份到安全位置
- 使用加密存储

# ❌ 错误做法
- 上传到 GitHub（即使私有仓库）
- 通过邮件发送
- 明文存储在客户服务器
```

### 2. 安全部署

```bash
# ✅ 正确做法
- 使用 HTTPS
- 限制访问 IP
- 设置强 Admin Token
- 定期更新系统

# ❌ 错误做法
- 使用 HTTP 明文传输
- 开放端口到公网
- 使用默认密码
- 长期不更新
```

### 3. 客户管理

```bash
# ✅ 正确做法
- 建立客户数据库
- 记录 License 使用情况
- 定期检查异常
- 提供技术支持

# ❌ 错误做法
- 无记录分发 License
- 不跟踪使用状态
- 忽略异常行为
```

---

## 总结

FLVX 授权系统采用**分离式架构**：

- ✅ **主项目开源** - 建立信任，吸引用户
- ✅ **授权系统私有** - 保护核心资产
- ✅ **RSA 加密** - 工业级安全保障
- ✅ **域名绑定** - 防止 License 滥用

这种设计既保持了开源的透明度，又确保了正式授权的安全性。

---

## 相关文档

- [部署指南](../doc/LICENSE_DEPLOY.md)
- [API 文档](../doc/docs/api.md)
- [安全最佳实践](../doc/docs/security.md)

## 联系支持

- 邮箱：support@yourdomain.com
- Telegram: https://t.me/flvxpanel
