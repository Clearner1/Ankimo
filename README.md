# Ankimo

一个连接本地 Anki 的轻量笔记流：用接近 Flomo 的方式快速记录短笔记，也可以创建正常参与复习的问答卡。

## 能力

- 标签树、置顶标签、牌组与三色旗标筛选
- Anki 搜索语法、编辑、删除与连续加载
- 短笔记自动进入 `Ankimo` 牌组并暂停
- 问答卡保留牌组、模板和正常复习语义
- 最近 12 周复习热力图、统计与同步
- 桌面和移动端响应式界面

Anki 是唯一数据源。网页通过 AnkiConnect v6 读写本地 Anki，不维护第二份笔记数据库。

## 本地开发

前置条件：Node.js 22、已启动的 Anki，以及已安装并启用的 AnkiConnect。

```bash
npm ci
npm run dev
```

默认访问 `http://127.0.0.1:5173`。本地访问会直接连接 `http://127.0.0.1:8765`，因此 AnkiConnect 的 `webCorsOriginList` 需要允许开发地址，例如：

```json
{
  "webCorsOriginList": [
    "http://127.0.0.1:5173",
    "http://localhost:5173"
  ]
}
```

## 工程检查

```bash
npm run check
```

该命令依次执行 ESLint、TypeScript、Vitest、Knip 和生产构建。浏览器 E2E 由人工验收负责，不包含在自动检查中。

## Docker 部署

生产镜像先用 Vite 构建静态文件，再由 Nginx 托管，并通过 `/anki` 反向代理到宿主机 AnkiConnect。

```bash
htpasswd -c .htpasswd anki
docker compose up -d --build
```

访问 `http://127.0.0.1:3000`。`.htpasswd` 以只读卷挂载，不会写入 Git、构建上下文或镜像。

如需经 Cloudflare Tunnel 远程访问，只需将现有 Tunnel 上游保持为本机 `http://localhost:3000`。Anki 和 AnkiConnect 仍运行在这台本地设备上。

## 目录

```text
src/
├── api/             AnkiConnect 客户端
├── domain/          查询、标签、笔记与复习纯逻辑
└── features/        composer、navigation、notes、review
style.css            既有 Impeccable UI 设计系统
nginx.conf           静态托管、Basic Auth 与 /anki 反代
```

`src/App.tsx` 只组合功能模块和少量跨模块状态；没有额外的路由器、全局状态库或客户端缓存层。

## 人工验收重点

- 本地与远程环境的 AnkiConnect 连接状态
- 短笔记创建后确实暂停，问答卡正常进入复习
- 标签、旗标、牌组、搜索和热力图日期筛选
- 编辑、删除、同步、答案隐藏与连续加载
- 768px 移动侧栏和 480px 手机布局

## License

MIT
