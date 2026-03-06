# 设计文档：Bridge Memory + 话题收尾

**日期**：2026-03-06
**状态**：已批准，待实施

---

## 设计目标

让 BridgeIt 从"每次聊天独立"进化为"有记忆的关系调解人"：换话题时给这段对话一个有仪式感的收尾，同时积累两人的关系画像，让 AI 分析随时间越来越懂这段关系。

---

## 功能一：话题收尾卡片（Bridge Moment）

### 触发
用户点"换新话题"按钮 → `new-topic-break` 事件 → 服务端在创建 topic-break 之后，**额外调用一次 AI** 生成话题总结。

### AI 新增返回字段
```json
{
  "topicSummary": "在这段对话里，你们相互理解了：[1-2句话]"
}
```

### UI：Bridge Moment 卡片
出现在 topic-break 分割线**上方**，样式与 Bridge AI 卡片相似但用蓝紫渐变（区分于金色分析卡）：
- 标题：`🌉 Bridge Moment`
- 正文：topicSummary 内容
- 右下角：时间戳
- 双方均可见（不区分发送方/接收方）

### Socket 事件
- 新增：`topic-summary`，payload：`{ roomId, summary, timestamp }`
- 服务端在 `new-topic-break` 处理完后异步发出

---

## 功能二：Bridge 日志页面

### 入口
`chat.html` topbar 新增 📖 按钮（ ⚙️ 左侧），跳转至 `/journal.html?room=<roomId>`。

### 页面结构（深色玻璃，与整体 UI 一致）
1. **Topbar**：返回按钮 + "🌉 Bridge 日志" 标题
2. **关系画像卡片**（可折叠）：`relationshipProfile` 内容，标注"AI 基于 N 段对话生成"
3. **时间线**：按日期倒序列出所有 Bridge Moment 卡片

### 页面文件
新建 `public/journal.html`

---

## 功能三：AI 记忆集成

### Room 文档新增字段
```json
{
  "topicHistory": [
    { "timestamp": 1741234567890, "summary": "在这段对话里..." }
  ],
  "relationshipProfile": "你们经常在期望沟通上存在误解..."
}
```
- `topicHistory`：每次话题收尾追加，保留最近 20 条
- `relationshipProfile`：每 5 个话题收尾后，AI 重新生成

### AI Prompt 增强
每次消息分析时，将以下内容注入 system prompt：
- 最近 5 条 `topicHistory`（按时间倒序）
- 当前 `relationshipProfile`（如存在）

格式：
```
【关系背景】
最近对话记录：
- [timestamp] [summary]
- ...
关系画像：[relationshipProfile]
```

### 话题收尾 AI 调用
独立的 AI 调用（不影响消息分析流程）：
- 输入：当前话题的全部消息（最近一个 topic-break 之后的消息）
- Prompt：生成 `topicSummary` 字段
- 结果：存入 `topicHistory`，触发 `topic-summary` socket 事件

### Profile 更新时机
`topicHistory.length % 5 === 0` 时，追加一次 AI 调用生成新 `relationshipProfile`。

---

## 受影响文件

| 文件 | 改动类型 |
|---|---|
| `server.js` | Room schema 新字段、话题收尾 AI 调用、profile 更新、prompt 注入 |
| `public/chat.html` | `topic-summary` 事件处理、Bridge Moment 卡片 CSS+JS、📖 topbar 按钮 |
| `public/journal.html` | 新建：日志页面（深色玻璃风格） |

---

## 不在本次范围内
- 用户手动编辑关系画像
- 跨房间记忆（每个聊天室独立）
- 日志导出/分享
