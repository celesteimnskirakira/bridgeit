# Bridge 状态回显 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在发送方的消息气泡下方显示一行淡金色状态，告知"Bridge AI 已为对方建立洞察"，复用已有 insight 字段，零额外 API 调用。

**Architecture:** 纯前端改动。`ai-analysis` socket 事件已有，加一个 `senderId === myId` 分支，找到对应气泡行，插入 `.bridge-status` 元素。3 秒后将其透明度降至 0.3。

**Tech Stack:** Vanilla JS, CSS transition, Socket.io（已有）

---

### Task 1：chat.html — 新增 `.bridge-status` CSS 样式

**Files:**
- Modify: `public/chat.html`（`<style>` 块末尾，第 125-126 行区域）

**Step 1：在 `</style>` 之前添加样式**

找到（第 125-126 行）：
```css
    .btn-primary:active { opacity: 0.85; }
  </style>
```

替换为：
```css
    .btn-primary:active { opacity: 0.85; }
    .bridge-status { font-size: 0.65rem; color: rgba(255,213,79,0.5); margin-top: 3px; margin-right: calc(50% + 10px); text-align: right; opacity: 0; transition: opacity 0.4s; position: relative; z-index: 1; padding: 0 2px; }
    .bridge-status.visible { opacity: 1; }
    .bridge-status.dim { opacity: 0.3; }
  </style>
```

**Step 2：手动验证**

打开 DevTools → 确认 `.bridge-status` 类存在且无语法错误。

**Step 3：提交**

```bash
cd /Users/celestevega/Desktop/Bridge_it/bridgeit
git add public/chat.html
git commit -m "feat: add .bridge-status CSS for sender echo line"
```

---

### Task 2：chat.html — 新增 `renderBridgeStatus` 函数 + 绑定 socket 事件

**Files:**
- Modify: `public/chat.html`（script 块）

**Step 1：找到 `renderAICard` 函数定义的位置**

找到：
```javascript
function renderAICard(analysis) {
```

在其**前面**插入新函数：

```javascript
function renderBridgeStatus(analysis) {
  const bubble = document.getElementById('msg-' + analysis.messageId);
  if (!bubble) return;
  const row = bubble.parentElement;
  if (!row) return;
  // 防止重复插入
  if (row.nextElementSibling?.classList?.contains('bridge-status')) return;
  const statusEl = document.createElement('div');
  statusEl.className = 'bridge-status';
  const insight = (analysis.insight || '').slice(0, 30);
  statusEl.textContent = '💡 Bridge 已建立 · ' + insight + (analysis.insight?.length > 30 ? '…' : '');
  row.insertAdjacentElement('afterend', statusEl);
  // fade in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => statusEl.classList.add('visible'));
  });
  // dim after 3s
  setTimeout(() => {
    statusEl.classList.remove('visible');
    statusEl.classList.add('dim');
  }, 3000);
}

```

**Step 2：在 `ai-analysis` socket 事件中添加发送方分支**

找到（第 223-228 行）：
```javascript
socket.on('ai-analysis', analysis => {
  if (analysis.roomId !== roomId) return;
  hideThinking();
  attachTranslations(analysis);
  if (analysis.receiverId === myId) renderAICard(analysis);
});
```

替换为：
```javascript
socket.on('ai-analysis', analysis => {
  if (analysis.roomId !== roomId) return;
  hideThinking();
  attachTranslations(analysis);
  if (analysis.receiverId === myId) renderAICard(analysis);
  if (analysis.senderId === myId) renderBridgeStatus(analysis);
});
```

**Step 3：手动验证**

1. 打开两个浏览器窗口（两个账号）进入同一聊天室
2. 发送一条消息
3. 等待 AI 分析完成（2-5 秒）
4. 发送方窗口：气泡下方出现淡金色 `💡 Bridge 已建立 · [insight 前 30 字]`
5. 3 秒后状态行变淡（opacity 0.3），不消失
6. 接收方窗口：金色 Bridge AI 卡片正常显示（不受影响）

**Step 4：提交**

```bash
git add public/chat.html
git commit -m "feat: show Bridge status echo to sender after AI analysis"
```

---

### Task 3：推送并线上验证

**Step 1：推送**

```bash
git push origin main
```

**Step 2：线上验证（Render 部署后）**

1. 两个设备或浏览器分别登录不同账号
2. 发消息 → 发送方看到淡金色 Bridge 状态行
3. 接收方 AI 卡片正常
4. 翻译功能不受影响

---
