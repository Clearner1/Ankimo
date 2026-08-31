# Mac Durable Outbox 提案

> **Core text Capture status: Implemented, deployed, and accepted on a real iPhone (2026-08-29)**
>
> **Voice extension status: Implemented on `feature/voice-capture` at `135e109`; not integrated or deployed; real-device acceptance pending (2026-08-31)**

本文记录 Mac Durable Outbox 的实现合同。代码已在 `server/ankimo-api.mts` 中实现，并已部署到生产 Mac；Caddy `/api/captures` 路由也已加载。用户已在真实 iPhone 上完成 URLSession/mTLS 写入、离线恢复和无重复验收。Anki 仍是已写入数据的唯一事实来源。

### Implementation checkpoint

- Internal API: `POST /api/captures` and `GET /api/captures/<uuid>`.
- Capture requests use `https://ankimo.yzr-stack.top/api/captures` and the existing API process on `127.0.0.1:8787`; this reuses the real-iPhone-proven client-certificate host and does not use the existing Bearer middleware.
- The route is fail-closed unless Caddy injects `X-Ankimo-Client-Verified: 1` after verifying mTLS; a client-supplied marker must be stripped first.
- Caddy now forwards `/api/captures*` to the local API after stripping any client-supplied marker and injecting `X-Ankimo-Client-Verified: 1`; configuration validation, reload, and a local fail-closed route check passed. The user verified the public client-certificate path on the real iPhone on 2026-08-29.
- The CLI stores the outbox at `~/Library/Application Support/Ankimo/outbox.sqlite3`; tests use `:memory:` or an injected temporary path.
- Native memo and Q&A captures use deck `Ankimo`, models `XXHK - 划线` and `XXHK - 问答`, and leave cards active. This supersedes the older Web short-note suspension wording below.
- The voice extension keeps `mode: memo`, accepts one bounded M4A, and invokes
  `~/.codex/skills/typeless-transcribe/scripts/transcribe.js` as a fixed
  no-shell child process. Tests inject a fake transcriber and never upload real
  audio to Typeless.

## 1. 背景与目标

当前新建笔记的用户请求会等待一串远程往返：检查牌组和模板、写入 Anki，以及刷新笔记列表和导航元数据。手机经公网访问 Mac 时，这些串行请求会把本来已经完成的写入放大成较长的等待时间。

Mac Durable Outbox 的目标是把“手机把内容可靠交给 Mac”和“Mac 把内容写入本地 Anki”分开：

1. 手机只提交一次创建命令。
2. Mac 先将命令持久化到本地 SQLite，落盘成功后立即确认。
3. Mac 进程在后台通过本机 AnkiConnect 完成现有写入流程。
4. Anki 仍然是所有已同步笔记的最终事实来源。
5. Outbox 只保存尚未完成的创建命令，不成为第二套笔记数据库。

目标是降低公网等待、支持 Anki 暂时关闭后的可靠重试，并保持现有卡片字段、查询语法和 native memo/Q&A active 语义不变。

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
  → iPhone 生成 captureId
  → POST 到 Mac
  → Mac 校验并写入 SQLite
  → transaction commit
  → 返回 202 queued
  → 前端关闭新建弹窗
  → worker 在本机执行 Anki 写入
  → 状态变为 synced 或 needs_attention
```

Mac 在线但 Anki 未打开时，命令仍可进入 `queued`，随后自动重试。Mac 本身不可达时，Mac 端无法确认本地落盘；原生 iOS 的本地待同步队列负责保留内容并在下次启动或网络恢复后重试。

语音短笔记沿用同一条队列：Mac 先将 M4A 原子写入私有 staging
目录并提交 SQLite，再执行一次 Typeless 转录。转录成功后保存文字，
随后以 `ankimo-<captureId>.m4a` 写入 Anki media，并将“手输文字、转录
文字、`[sound:...]`”写入现有 `引用` 字段。媒体和字段精确回读完成前
不得报告 `synced`。

这不是把所有 Anki 笔记复制到 Mac。浏览、搜索、编辑、删除和长期组织仍继续以现有 AnkiConnect 数据为准；Outbox 只展示极短生命周期的“待写入”状态。

## 3. Outbox 持久化设计

首选使用 Mac 当前 Node 运行时可用的 `node:sqlite`，不新增 ORM、数据库服务或队列依赖。数据库使用 `DELETE` journal，放在用户私有应用目录，目录权限 `0700`，数据库文件权限 `0600`：

```text
~/Library/Application Support/Ankimo/outbox.sqlite3
```

### 3.1 `captures` 表

建议字段：

| 字段 | 作用 |
| --- | --- |
| `capture_id` | 客户端生成的 UUID，同时作为幂等键 |
| `fingerprint` | 规范化 payload 的摘要，防止同一 ID 对应不同内容 |
| `mode` / `front` / `back` / `tags_json` | 规范化后的创建命令；不存 Anki 全量数据 |
| `status` | 当前状态机状态 |
| `note_id` | Anki 成功返回的 note ID，可为空 |
| `attempt_count` | 后台尝试次数 |
| `next_attempt_at` | 下次重试时间 |
| `error_code` | 可分类的最后错误 |
| `created_at` / `updated_at` | 时间戳 |
| `audio_filename` / `audio_sha256` | 短期 staging 文件和幂等摘要；非语音任务为空 |
| `transcript` / `transcription_started` | 转录结果与崩溃恢复边界；同步后清空 |

推荐唯一约束：`capture_id`。重复提交同一 `capture_id` 时必须比较 `fingerprint`：内容相同则返回原任务，内容不同则返回 `409 Conflict`，避免幂等键被复用造成数据混淆。
任务进入 `synced` 后清空 `front`、`back` 和 `tags_json`，只保留 `fingerprint`、`mode`、`note_id` 与状态 tombstone，用于后续幂等判断而不永久累积正文。

### 3.2 图片文件

当前 native Capture 合同不接受图片；不创建媒体目录、不把图片塞入 SQLite，也不为未提出的图片需求引入上传协议。

### 3.3 生命周期清理

第一版不自动删除 `synced` tombstone：同一 UUID 在 iPhone 很久以后重传时仍必须保持幂等。同步完成时正文、答案和标签已立即清空，长期只保留很小的 fingerprint/note-ID 状态行。只有增加明确的 iPhone acknowledgement 或保留期合同后才做 tombstone 清理；`queued`、`preparing`、`writing` 和 `needs_attention` 不得按时间删除。

## 4. 状态机与写入语义

```text
queued
  → preparing
  → writing
  → synced

任意可重试错误 ───────────────► queued（带退避）
写入结果不确定 ───────────────► needs_attention
永久配置/数据错误 ────────────► needs_attention
```

状态含义：

| 状态 | 含义 | 处理规则 |
| --- | --- | --- |
| `queued` | 已可靠保存到 Mac，等待 Anki | worker 自动处理 |
| `preparing` | 检查牌组和模板 | 可安全重试 |
| `writing` | 正在执行 `addNote` | 中断后不能直接重复创建 |
| `synced` | Anki 已写入并持久化 note ID | 结束 |
| `needs_attention` | 结果不确定或需人工处理 | 停止自动创建，提供诊断/重试入口 |

Capture 必须保持当前业务顺序：

```text
检查/创建 Ankimo 牌组
  → 检查模板字段
  → addNote
  → 立即持久化 note ID
  → synced
```

memo 和问答卡都保持 active，正常参与 Anki 复习，不执行短笔记暂停。

`addNote` 是最需要谨慎的边界：如果 Mac 在 Anki 已创建笔记之后、SQLite 记录 `note_id` 之前崩溃，结果无法可靠判断。此时宁可转为 `needs_attention`，也不自动再次 `addNote`，以避免重复笔记。

Typeless 调用也是未知结果边界。worker 在调用前持久化
`transcription_started = 1`；进程若在结果落盘前中断，重启后进入
`TRANSCRIPTION_STATUS_UNKNOWN`，绝不自动再次上传。只有用户触发
`POST /api/captures/<uuid>/retry-transcription` 才会重新排队，而且该
入口拒绝 `WRITE_STATUS_UNKNOWN` 等不安全状态。

后台 worker 不需要独立进程、事件总线或任务框架：复用现有 Mac API 服务，服务启动时扫描未完成任务，新任务提交后唤醒同一个单线程处理循环。worker 用 SQLite 原子 claim 保证多个服务实例共享数据库时同一 capture 也只会有一个 `addNote`。全局一次处理一个任务，保持简单的 FIFO 顺序，避免多个写入同时操作 Anki collection。

建议重试策略：Anki 连接或其他 transport 暂时不可达时首次约 15 秒后重试，随后约每 60 秒持续重试；Anki action 明确报告模型不存在、字段不足等确定性配置错误进入 `needs_attention`，`addNote` 结果不确定也进入 `needs_attention`。

## 5. Capture API

这是给原生 iOS 使用的内部接口，不加入现有 AI OpenAPI，也不修改现有 Bearer API 合同。公网入口固定为 `https://ankimo.yzr-stack.top/api/captures`，复用已通过真实 iPhone 验证的客户端证书主机；API 进程本身仍只绑定 `127.0.0.1:8787`。

### 5.1 创建任务

```http
POST /api/captures
Content-Type: application/json
```

```json
{
  "captureId": "client-generated-uuid",
  "mode": "memo",
  "front": "笔记正文",
  "tags": []
}
```

语音 memo 可让 `front` 为空，并增加：

```json
{
  "audio": {
    "format": "m4a",
    "data": "base64-encoded-audio"
  }
}
```

音频只允许 memo、M4A 和单文件。原始 M4A 上限为 5 MiB；包含 Base64
的完整 Capture JSON 上限为 8 MiB。纯文字接口仍沿用 256 KiB 上限。

成功写入 Outbox 后返回：

```http
202 Accepted
```

```json
{
  "captureId": "client-generated-uuid",
  "status": "queued"
}
```

`202` 只表示 Mac 已可靠接收，不表示 Anki 已经完成。重复提交同一 `captureId` 且内容相同，返回相同任务的当前状态；内容不一致返回 `409`。
Capture 的成功、失败和未找到响应均带 `Cache-Control: no-store`。

### 5.2 查询状态

```http
GET /api/captures/<captureId>
```

客户端只在存在未完成任务时查询；没有未完成任务时停止查询。暂不使用 WebSocket、SSE 或事件总线。

普通 Anki 离线错误由 worker 自动重试；`needs_attention` 只通过后续人工确认处理。合同不提供自动再次 `addNote` 的 retry 路由；新增的显式 retry 仅允许尚未进入 Anki 写入边界的转录失败。

## 6. 图片、请求大小与性能

纯文字请求在 SQLite commit 后快速返回，不等待 Anki 的网络反馈。当前请求沿用既有 `256 KiB` JSON 上限；图片不在 Capture 合同内。

语音扩展使用一个有界 JSON 上传文件是第一版的刻意简化：典型录音约
30 秒，iOS 端上限五分钟。只有真实录音超过当前 5 MiB 上限时才改为
multipart 或分块上传，不提前引入上传依赖。

## 7. 前端行为

原生 iOS 将创建动作发送到 Capture API，收到 `202` 后立即关闭编辑页；列表由本地 pending capture 立即更新，后台只查询状态：

- `queued` / `preparing` / `writing`
- `synced`
- `needs_attention`

本地 pending capture 不能伪装成 Anki 已写入；它必须明确标记为待写入，不得成为长期第二数据源。

笔记流、标签和牌组不因每次创建而强制整页刷新。Capture 完成后的状态查询只更新 pending capture；常规 Anki 列表仍按现有加载、搜索、编辑、删除和同步入口工作。用户主动刷新或 Anki 同步后，再从 Anki 读取最终结果。

## 8. 安全边界

- Capture API 仅绑定 Mac 本地 API 服务已有的监听边界，不把 AnkiConnect 直接暴露给公网。
- 当前 Capture 路由依赖客户端证书和 Caddy 的受保护入口，故意不走现有 Bearer middleware。
- Node 路由要求 `X-Ankimo-Client-Verified: 1`；Caddy 必须先删除客户端传入的同名 header，再只在 mTLS 验证成功后注入它。该 marker 不是 Caddy/mTLS 本身，不能替代尚未批准的代理配置。
- 当前生产 Caddy 已转发 `/api/captures*`，并在转发前剥离客户端伪造的 marker、注入 `X-Ankimo-Client-Verified: 1`；配置校验、reload、本地 fail-closed 路由检查和 2026-08-29 的真实 iPhone 客户端证书入口验收均已通过。
- 严格检查请求方法、`Content-Type`、字段类型、标签长度和总请求大小。
- 日志只记录 capture ID、状态、错误类别和耗时，不记录正文、答案、标签或凭据。
- 不记录音频、转录正文、Typeless stdout/stderr、登录 token、设备 ID
  或请求头。Staging 目录为 `0700`，录音文件为 `0600`。
- 目录和数据库文件使用最小权限；异常 JSON 必须拒绝。

## 9. 失败恢复矩阵

| 故障 | 用户看到的状态 | Mac 行为 | 是否自动重试 |
| --- | --- | --- | --- |
| Mac 不可达 | 请求失败，表单保留 | 无法落盘 | 否，等用户重试 |
| SQLite commit 前崩溃 | 请求失败 | 没有任务 | 用户重试 |
| commit 后 Anki 关闭 | 已保存到 Mac，等待 Anki | 保留 `queued` | 是 |
| `addNote` 前失败 | 等待重试 | 回到 `queued` | 是 |
| `addNote` 后结果不明 | 写入状态待确认 | `needs_attention` | 否，避免重复 |
| 已有 note ID | 已完成写入 | `synced` | 否 |
| 牌组/模板永久错误 | 需要处理配置 | `needs_attention` | 否 |
| Typeless 登录/请求失败 | 录音安全保留、需要处理 | `needs_attention` | 否；仅用户显式重试 |
| 转录过程中服务重启 | 转录结果未知 | `needs_attention` | 否；仅用户显式重试 |
| 服务重启 | 不改变用户状态 | 启动时恢复未完成任务 | 按状态继续 |

## 10. 验收标准

实现获得批准后，至少应验证：

1. 纯文字创建只发生一次手机到 Mac 的写请求。
2. SQLite commit 成功后立即返回 `202`，前端不等待 Anki 完成。
3. 服务重启后未完成任务仍存在并继续处理。
4. Anki 关闭时任务保持排队，重新打开后自动写入。
5. 相同 `captureId` 重复提交不会创建两条笔记。
6. `addNote` 结果不确定时不会盲目重复创建。
7. memo 和问答卡使用固定 native 牌组/模板并保持 active。
8. 标签、模板和牌组行为不退化。
9. 浏览、搜索、编辑、删除、同步和现有 Anki 查询语法不改变。
10. 创建任务不会为了显示新笔记而强制刷新所有卡片和导航数据。
11. 服务重启、请求大小和公网访问控制符合安全边界。
12. CLI/API/单元检查通过；真实 iPhone 体验与 Capture 路由部署已由用户于 2026-08-29 验收，不使用浏览器自动化。

语音扩展另需在部署后验证：真实 Typeless 登录下只上传一次、纯录音与
手输文字顺序、Anki/Ankimo 双端播放、锁屏停止录音、后台 mTLS 文件
上传、强杀后同 UUID 恢复，以及失败后手动重试。当前 22 个聚焦 API
测试、聚焦 ESLint 和 TypeScript 检查通过；这些不替代真实录音验收。

## 11. 明确非目标

本提案第一版明确不做：

- 不做图片 Capture、编辑、删除、批量操作或复习操作的异步队列；先只解决文字创建。
- Mac 端不建立完整 iPhone 离线数据库、Service Worker 或长期浏览器缓存；原生 iOS 仅负责保存待同步 capture。
- 不复制完整 Anki collection，不替代 Anki，不做双向同步。
- 不做冲突解决、跨设备合并或多用户队列。
- 不自动执行每条笔记的 AnkiWeb `sync()`；现有同步按钮继续负责 Anki 自身同步。
- 不引入 Redux、Zustand、React Query、React Router、事件总线、Registry、IoC、插件运行时或独立任务系统。
- 不为“未来可能需要”新增泛化抽象、数据库服务或上传依赖。
- 不修改当前架构源事实、AnkiConnect API 合同、查询语法、卡片字段、native memo active 语义或现有部署安全边界。

## 12. 验收记录

2026-08-29，用户在真实 iPhone 14 Pro（iOS 26.6）完成 native capture 验收：

1. memo 保存后立即关闭编辑页并刷新列表。
2. 无网络时仍立即保存到手机，恢复网络后自动同步。
3. 强制结束 App 后重新打开，任务沿用原 capture ID 继续处理且不重复写入。
4. Q&A capture 成功写入固定模型并保持 active。

生产 Mac 服务重启恢复由 API/worker 自动化测试覆盖；后续只有出现新的故障证据时才增加专门的现场演练。
