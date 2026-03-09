# 📝 Ankimo

一个类似 [Flomo](https://flomoapp.com/) 风格的 Anki 笔记管理器，通过 [AnkiConnect](https://foosoft.net/projects/anki-connect/) 插件连接你的 Anki，让你在浏览器中以更优雅的方式浏览、搜索和创建笔记。

![AnkiConnect](https://img.shields.io/badge/AnkiConnect-v6-blue?style=flat-square) ![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square) ![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

## ✨ 功能特性

- 🏷️ **标签树** — 支持 `::` 层级结构，可折叠展开，点击按标签筛选笔记
- 📚 **牌组列表** — 展示所有牌组，点击按牌组筛选
- 📝 **笔记瀑布流** — 按时间倒序展示，无限滚动加载
- ✏️ **快速创建** — 选择牌组和模板，一键创建新笔记
- 🔍 **搜索** — 支持 Anki 原生搜索语法（如 `tag:Java`、`deck:Default`）
- 🟩 **复习热力图** — 可视化展示最近 16 周的复习记录
- 📊 **统计面板** — 笔记数、标签数、今日复习数
- 🔄 **同步** — 一键触发 Anki 同步
- 📱 **响应式** — 支持移动端自适应布局
- ⌨️ **快捷键** — `Ctrl/Cmd + K` 快速聚焦搜索框
- 🔒 **Basic Auth** — Nginx 层认证，保护你的数据安全

## 📋 前置要求

1. **Anki** — 已安装 [Anki](https://apps.ankiweb.net/) 桌面版
2. **AnkiConnect 插件** — 在 Anki 中安装 AnkiConnect 插件（代码：`2055492159`）
   - 打开 Anki → 工具 → 插件 → 获取插件 → 输入 `2055492159` → 确定
   - 重启 Anki
3. **配置 AnkiConnect CORS** — 允许本地服务器访问 AnkiConnect API
   - 打开 Anki → 工具 → 插件 → 选中 AnkiConnect → 配置
   - 将 `webCorsOriginList` 修改为：
   ```json
   "webCorsOriginList": [
       "http://localhost",
       "http://localhost:3000",
       "http://localhost:8080",
       "http://127.0.0.1:3000"
   ]
   ```
   - 点击确定，重启 Anki

## 🚀 快速开始

### 方法一：直接打开（本地使用）

```bash
git clone https://github.com/Clearner1/ankimo.git
cd ankimo

# 启动本地服务器
python -m http.server 3000

# 浏览器访问 http://127.0.0.1:3000
```

### 方法二：Docker 部署（推荐，支持远程访问）

```bash
git clone https://github.com/Clearner1/ankimo.git
cd ankimo

# 生成密码文件（用户名: anki，密码自定义）
htpasswd -c .htpasswd anki

# 启动容器
docker compose up -d --build

# 浏览器访问 http://127.0.0.1:3000
```

### 方法三：Docker + Cloudflare Tunnel（手机远程访问）

在方法二的基础上，配置 Cloudflare Tunnel 实现内网穿透：

```yaml
# ~/.cloudflared/config.yml 添加一条 ingress 规则
ingress:
  - hostname: ankimo.你的域名.com
    service: http://localhost:3000
```

然后添加 DNS 记录并重启 tunnel：

```bash
# 添加 CNAME 记录
cloudflared tunnel route dns <TUNNEL_ID> ankimo.你的域名.com

# 重启 tunnel
brew services restart cloudflared
```

> **⚠️ 注意：** 
> - 启动前请确保 Anki 已打开并且 AnkiConnect 插件已启用（默认监听 `127.0.0.1:8765`）
> - 如果 QUIC 协议被防火墙拦截，在 config.yml 中添加 `protocol: http2`

## 🏗️ 项目结构

```
ankimo/
├── index.html         # 页面结构
├── style.css          # 样式（暗色侧边栏 + 亮色内容区）
├── app.js             # 应用逻辑（API 通信、标签树、笔记渲染）
├── Dockerfile         # Docker 镜像构建
├── docker-compose.yml # Docker Compose 编排
├── nginx.conf         # Nginx 配置（静态托管 + API 反代 + Basic Auth）
├── .htpasswd          # 密码文件（不上传 Git）
├── .gitignore
└── README.md
```

## 🔧 技术栈

- **纯前端** — HTML + CSS + JavaScript，无需构建工具，无框架依赖
- **AnkiConnect API v6** — 通过 HTTP POST 请求与 Anki 通信
- **Nginx** — 静态文件托管 + AnkiConnect 反向代理 + Basic Auth
- **Docker** — 一键部署
- **Cloudflare Tunnel** — 内网穿透，手机远程访问

## 📖 使用说明

| 操作 | 说明 |
|------|------|
| 点击左侧标签 | 按标签筛选笔记 |
| 点击左侧牌组 | 按牌组筛选笔记 |
| 搜索框输入 | 支持 Anki 搜索语法，如 `tag:Java`、`deck:Default`、`added:1` |
| 顶部输入区 | 填写正面/背面内容，选择牌组和模板，点击保存创建笔记 |
| 笔记卡片上的标签 | 点击可快速按该标签筛选 |
| 🔄 同步按钮 | 触发 Anki 云同步 |
| `Cmd/Ctrl + K` | 快速聚焦搜索框 |

## 📄 License

MIT
