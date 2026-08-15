# Mac Durable Outbox 提案

> **Status: Deferred proposal / 当前未实施**

本文只保存已讨论的未来方案，不改变当前架构源事实，也不表示本仓库已经实现 Mac Durable Outbox。当前 Ankimo 仍使用既有 Vite + React + TypeScript 前端、现有 Mac 服务、AnkiConnect 和 Anki 数据流；Anki 仍是已写入数据的唯一事实来源。本提案只有在后续明确批准并完成独立实现、验收后才可生效。

## 1. 背景与目标

当前新建短笔记的用户请求会等待一串远程往返：写入 Anki、查找新卡片、暂停短笔记、回读暂停状态，以及刷新笔记列表和导航元数据。手机经公网访问 Mac 时，这些串行请求会把本来已经完成的写入放大成较长的等待时间。

Mac Durable Outbox 的目标是把“手机把内容可靠交给 Mac”和“Mac 把内容写入本地 Anki”分开：

1. 手机只提交一次创建命令。
2. Mac 先将命令持久化到本地 SQLite，落盘成功后立即确认。
3. Mac 进程在后台通过本机 AnkiConnect 完成现有写入流程。
4. Anki 仍然是所有已同步笔记的最终事实来源。
5. Outbox 只保存尚未完成的创建命令，不成为第二套笔记数据库。

目标是降低公网等待、支持 Anki 暂时关闭后的可靠重试，并保持现有卡片字段、查询语法、短笔记暂停语义和问答卡复习语义不变。

## 2. 目标架构与数据流

```text
iPhone / PWA
      │  一次 POST：创建命令
      ▼
Mac Ankimo API
      │  SQLite transaction commit
      ▼
Durable Outbox ──► 单线程后台 worker ──► 127.0.0.1:8765 AnkiConnect ──► Anki
      │
      └── 202 Accepted：已可靠保存到 Mac
```

文字短笔记的建议流程：

```text
用户点击保存
  → PWA 生成 captureId
  → POST 到 Mac
  → Mac 校验并写入 SQLite
  → transaction commit
  → 返回 202 queued
  → 前端关闭新建弹窗
  → worker 在本机执行 Anki 写入
  → 状态变为 synced 或 needs_attention
```

Mac 在线但 Anki 未打开时，命令仍可进入 `queued`，随后自动重试。Mac 本身不可达时，浏览器无法确认本地落盘，不能显示“已保存”；现阶段不增加 iPhone 浏览器离线数据库或 Service Worker。

这不是把所有 Anki 笔记复制到 Mac。浏览、搜索、编辑、删除和长期组织仍继续以现有 AnkiConnect 数据为准；Outbox 只展示极短生命周期的“待写入”状态。

## 3. Outbox 持久化设计

首选使用 Mac 当前 Node 运行时可用的 `node:sqlite`，不新增 ORM、数据库服务或队列依赖。数据放在用户私有应用目录，目录权限 `0700`，数据库及临时文件权限 `0600`：

```text
~/Library/Application Support/Ankimo/outbox.sqlite3
~/Library/Application Support/Ankimo/outbox-media/
```

### 3.1 `captures` 表

建议字段：

| 字段 | 作用 |
| --- | --- |
| `id` | 客户端生成的 UUID，同时作为幂等键 |
| `fingerprint` | 规范化 payload 的摘要，防止同一 ID 对应不同内容 |
| `payload_json` | 模式、正文、答案、牌组、模板和标签；不存 Anki 全量数据 |
| `status` | 当前状态机状态 |
| `note_id` | Anki 成功返回的 note ID，可为空 |
| `attempt_count` | 后台尝试次数 |
| `next_attempt_at` | 下次重试时间 |
| `last_error_code` | 可分类的最后错误 |
| `last_error_message` | 面向日志和诊断的安全摘要，不含正文 |
| `created_at` / `updated_at` | 时间戳 |

推荐唯一约束：`id`。重复提交同一 `id` 时必须比较 `fingerprint`：内容相同则返回原任务，内容不同则返回 `409 Conflict`，避免幂等键被复用造成数据混淆。

### 3.2 图片文件

图片不长期塞在 SQLite 的 JSON 中。Mac 在接受命令时将图片解码到私有临时目录，所有文件安全落盘后才提交对应任务：

```text
outbox-media/<captureId>/<generated-file-name>
```

数据库只保留 capture ID、文件名、MIME、大小和本地路径。任务完成后删除已上传的临时文件；失败任务保留到重试结束或人工处理，以便恢复。

### 3.3 生命周期清理

`synced` 任务只为前端短时查询和对账保留，例如 24 小时后清理。`queued`、`preparing`、`writing`、`postprocessing` 和 `needs_attention` 不得按时间自动删除。清理必须只触及明确的 Outbox 文件，不触及 Anki collection。

## 4. 状态机与写入语义

```text
queued
  → preparing
  → writing
  → postprocessing
  → synced

任意可重试错误 ───────────────► queued（带退避）
写入结果不确定 ───────────────► needs_attention
永久配置/数据错误 ────────────► needs_attention
```

状态含义：

| 状态 | 含义 | 处理规则 |
| --- | --- | --- |
| `queued` | 已可靠保存到 Mac，等待 Anki | worker 自动处理 |
| `preparing` | 检查牌组、模板并准备图片 | 可安全重试 |
| `writing` | 正在执行 `addNote` | 中断后不能直接重复创建 |
| `postprocessing` | 已取得 note ID，正在暂停/验证 | 按 note ID 重试 |
| `synced` | Anki 写入及必要后处理完成 | 结束 |
| `needs_attention` | 结果不确定或需人工处理 | 停止自动创建，提供诊断/重试入口 |

短笔记必须保持当前业务顺序：

```text
检查/创建 Ankimo 牌组
  → 检查模板字段
  → 写入图片
  → addNote
  → 立即持久化 note ID
  → findCards
  → suspend
  → areSuspended 回读确认
  → synced
```

问答卡按现有规则创建并正常参与复习，不执行短笔记暂停。

`addNote` 是最需要谨慎的边界：如果 Mac 在 Anki 已创建笔记之后、SQLite 记录 `note_id` 之前崩溃，结果无法可靠判断。此时宁可转为 `needs_attention`，也不自动再次 `addNote`，以避免重复笔记。已经拿到 `note_id` 后，暂停或回读失败可以按该 ID 安全重试。

后台 worker 不需要独立进程、事件总线或任务框架：复用现有 Mac API 服务，服务启动时扫描未完成任务，新任务提交后唤醒同一个单线程处理循环。全局一次处理一个任务，保持简单的 FIFO 顺序，避免多个写入同时操作 Anki collection。

建议重试策略：Anki 暂时不可达时首次约 15 秒后重试，随后约每 60 秒重试；可重试错误使用有限退避，永久错误和不确定写入结果进入 `needs_attention`。

## 5. 提议的 Capture API

这是未来给 Ankimo 网页使用的内部接口，不修改现有受信任 AI OpenAPI、Bearer Token 合同或默认牌组行为。

### 5.1 创建任务

```http
POST /api/captures
Content-Type: application/json
```

```json
{
  "idempotencyKey": "client-generated-uuid",
  "mode": "memo",
  "deck": "Ankimo",
  "model": "XXHK - 划线",
  "front": "笔记正文",
  "back": "",
  "tags": [],
  "images": []
}
```

成功写入 Outbox 后返回：

```http
202 Accepted
```

```json
{
  "captureId": "client-generated-uuid",
  "status": "queued",
  "acceptedAt": 1786780000000
}
```

`202` 只表示 Mac 已可靠接收，不表示 Anki 已经完成。重复提交同一幂等键且内容相同，返回相同任务的当前状态；内容不一致返回 `409`。

### 5.2 查询状态

```http
GET /api/captures/<captureId>
GET /api/captures?after=<updatedAt>
```

第一版只在存在未完成任务时轮询，例如每 2 秒一次；没有未完成任务时停止轮询。暂不使用 WebSocket、SSE 或事件总线。

### 5.3 重试与人工处理

```http
POST /api/captures/<captureId>/retry
```

普通 Anki 离线错误由 worker 自动重试；只有 `needs_attention` 才需要明确的人工重试或状态确认。人工接口不能在结果不确定时无提示地再次执行 `addNote`。

## 6. 图片、请求大小与性能

纯文字请求可以在 SQLite commit 后快速返回；图片的物理上传时间不能消除，但不再额外等待 Anki 的多轮网络反馈。

第一版复用 Composer 已有的图片约束：

- PNG、JPEG、WebP。
- 最多 4 张。
- 单张最多 10MB。
- Capture API 使用独立的请求大小上限，约 56 MiB JSON 上限；既有 AI API 的 256 KiB 限制不改变。
- Mac 解码并落盘后才返回 `202`，避免只在内存中“接受”而服务崩溃后丢失。
- 文件名不直接信任客户端输入，使用服务端生成的名字；路径必须限制在私有 `outbox-media` 目录内。

如果真实数据证明大图 JSON 的内存开销不可接受，再单独设计流式或 multipart 上传；第一版不预先加入上传框架。

## 7. 前端行为

不新增 Redux、Zustand、React Query、路由或全局同步抽象。Composer 将创建动作发送到 Capture API，收到 `202` 后立即关闭弹窗并显示准确状态：

- `已保存到 Mac，正在写入 Anki`
- `已写入 Anki`
- `Anki 未连接，等待重试`
- `写入状态待确认`

“已保存到 Mac”不能伪装成“已保存到 Anki”。如果产品需要在后台完成前临时显示内容，可在当前页面顶部显示短生命周期的 pending capture；它必须明确标记为待写入，不得混入 Anki 查询结果，也不得成为长期第二数据源。

笔记流、标签和牌组不因每次创建而强制整页刷新。Capture 完成后的状态查询只更新 pending capture；常规 Anki 列表仍按现有加载、搜索、编辑、删除和同步入口工作。用户主动刷新或 Anki 同步后，再从 Anki 读取最终结果。

## 8. 安全边界

- Capture API 仅绑定 Mac 本地 API 服务已有的监听边界，不把 AnkiConnect 直接暴露给公网。
- 反向代理只转发明确的 Capture 路径；不放宽现有 AI API 的认证保护。
- 严格检查请求方法、`Origin`、`Content-Type`、字段类型、标签长度、图片 MIME 和总请求大小。
- 不在网页、源码、浏览器存储、SQLite 日志或响应中放置可信 AI Key。
- 日志只记录 capture ID、状态、错误类别和耗时，不记录正文、答案、标签、图片内容或凭据。
- 目录和文件使用最小权限；路径穿越、重复文件名和异常 JSON 必须拒绝。
- 公网未认证访问继续遵循现有 403/代理策略；不通过本提案调整 Cloudflare、Caddy 或其他站点安全配置。

## 9. 失败恢复矩阵

| 故障 | 用户看到的状态 | Mac 行为 | 是否自动重试 |
| --- | --- | --- | --- |
| Mac 不可达 | 请求失败，表单保留 | 无法落盘 | 否，等用户重试 |
| SQLite commit 前崩溃 | 请求失败 | 没有任务 | 用户重试 |
| commit 后 Anki 关闭 | 已保存到 Mac，等待 Anki | 保留 `queued` | 是 |
| `addNote` 前失败 | 等待重试 | 回到 `queued` | 是 |
| `addNote` 后结果不明 | 写入状态待确认 | `needs_attention` | 否，避免重复 |
| 已有 note ID 但暂停失败 | 等待 Anki 后处理 | `postprocessing` | 是 |
| 牌组/模板永久错误 | 需要处理配置 | `needs_attention` | 否 |
| 服务重启 | 不改变用户状态 | 启动时恢复未完成任务 | 按状态继续 |

## 10. 验收标准

实现获得批准后，至少应验证：

1. 纯文字创建只发生一次手机到 Mac 的写请求。
2. SQLite commit 成功后立即返回 `202`，前端不等待 Anki 完成。
3. 服务重启后未完成任务仍存在并继续处理。
4. Anki 关闭时任务保持排队，重新打开后自动写入。
5. 相同幂等键重复提交不会创建两条笔记。
6. `addNote` 结果不确定时不会盲目重复创建。
7. 短笔记最终仍会暂停，并通过 `areSuspended` 回读确认。
8. 问答卡仍正常参与 Anki 复习。
9. 图片、标签、模板和牌组行为不退化。
10. 浏览、搜索、编辑、删除、同步和现有 Anki 查询语法不改变。
11. 创建任务不会为了显示新笔记而强制刷新所有卡片和导航数据。
12. 日志、文件权限、请求大小和公网访问控制符合安全边界。
13. CLI/API/单元检查通过；真实 iPhone 体验由用户验收，不使用浏览器自动化。

## 11. 明确非目标

本提案第一版明确不做：

- 不在本次任务中实现 Outbox、SQLite、Capture API 或后台 worker。
- 不建立 iPhone 离线数据库、Service Worker 或长期浏览器缓存。
- 不复制完整 Anki collection，不替代 Anki，不做双向同步。
- 不做编辑、删除、批量操作或复习操作的异步队列；先只解决创建。
- 不做冲突解决、跨设备合并或多用户队列。
- 不自动执行每条笔记的 AnkiWeb `sync()`；现有同步按钮继续负责 Anki 自身同步。
- 不引入 Redux、Zustand、React Query、React Router、事件总线、Registry、IoC、插件运行时或独立任务系统。
- 不为“未来可能需要”新增泛化抽象、数据库服务或上传依赖。
- 不修改当前架构源事实、AnkiConnect API 合同、查询语法、卡片字段、短笔记暂停逻辑或现有部署安全边界。

## 12. 后续决策门

只有在最小速度实验仍不能接受时，才重新 review 本提案。届时需要再次明确：

1. Mac 离线时是否接受“无法确认保存”的产品语义。
2. `addNote` 结果不确定时是否接受人工确认，以换取不产生重复笔记。
3. 图片是否接受先完整上传到 Mac，再确认已可靠保存。
4. Capture API 的反向代理、认证和部署边界是否需要单独批准。

在这些决定获得批准前，本文件只是延期设计记录，不是当前实现要求。
