# Bridge Memory + 话题收尾 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 换话题时触发 AI 生成话题收尾卡片，积累话题历史和关系画像，让 AI 分析越来越懂这段关系，并提供用户可见的 Bridge 日志页面。

**Architecture:** 后端 server.js 新增话题收尾 AI 调用、Room 内存字段、日志 API；前端 chat.html 处理 `topic-summary` 事件并渲染 Bridge Moment 卡片；新建 journal.html 展示时间线和关系画像。

**Tech Stack:** Node.js + Express + Socket.io + MongoDB（已有），Vanilla JS + CSS（已有），OpenRouter AI（已有）

**参考文件:** `docs/plans/2026-03-06-bridge-memory-design.md`，`server.js`，`public/chat.html`

---

### Task 1：server.js — 新增 `updateRoomMemory` + `getTopicSummary` 函数

**Files:**
- Modify: `server.js`（在 `updateRoomTranslate` 函数之后添加）

**Step 1：在 `updateRoomTranslate` 函数后（第 ~180 行）添加两个新函数**

找到：
```javascript
// translateTo 以 { userId: string[] } 格式按用户存储
async function updateRoomTranslate(roomId, userId, langs) {
```

在 `updateRoomTranslate` 整个函数**之后**追加：

```javascript
async function updateRoomMemory(roomId, topicSummary) {
  const entry = { timestamp: Date.now(), summary: topicSummary };
  if (useDB) {
    // 追加到 topicHistory，保留最近 20 条
    await roomsCollection.updateOne(
      { id: roomId },
      { $push: { topicHistory: { $each: [entry], $slice: -20 } } }
    );
    // 每 5 条更新一次 relationshipProfile
    const room = await getRoomById(roomId);
    if (room && room.topicHistory && room.topicHistory.length % 5 === 0) {
      await updateRelationshipProfile(roomId, room);
    }
  } else {
    const rooms = loadRoomsFile();
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      if (!Array.isArray(room.topicHistory)) room.topicHistory = [];
      room.topicHistory.push(entry);
      if (room.topicHistory.length > 20) room.topicHistory = room.topicHistory.slice(-20);
      saveRoomsFile(rooms);
      if (room.topicHistory.length % 5 === 0) {
        await updateRelationshipProfile(roomId, room);
      }
    }
  }
}

async function updateRelationshipProfile(roomId, room) {
  try {
    const history = (room.topicHistory || []).slice(-10);
    if (history.length < 2) return;
    const summaries = history.map((h, i) => `${i + 1}. ${h.summary}`).join('\n');
    const resp = await openrouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: 'You are analyzing the long-term communication patterns of two people based on their conversation summaries. Write a 2-3 sentence relationship profile describing their recurring patterns, communication styles, and areas of shared understanding. Be warm, specific, and non-judgmental. Write in the language most common in the summaries.' },
        { role: 'user', content: `Conversation topic summaries:\n${summaries}\n\nWrite a relationship profile for these two people.` },
      ],
      temperature: 0.6,
    });
    const profile = resp.choices[0].message.content.trim();
    if (useDB) {
      await roomsCollection.updateOne({ id: roomId }, { $set: { relationshipProfile: profile } });
    } else {
      const rooms = loadRoomsFile();
      const r = rooms.find(r => r.id === roomId);
      if (r) { r.relationshipProfile = profile; saveRoomsFile(rooms); }
    }
  } catch (e) { console.error('updateRelationshipProfile error:', e.message); }
}

async function getTopicSummary(roomId, room) {
  const allMessages = await loadMessages(roomId);
  // 找最近一个 topic-break 之前的消息（即当前话题的消息）
  let endIdx = allMessages.length - 1;
  // 跳过最后的 topic-break 消息本身
  while (endIdx >= 0 && allMessages[endIdx].type === 'topic-break') endIdx--;
  // 找前一个 topic-break
  let startIdx = 0;
  for (let i = endIdx; i >= 0; i--) {
    if (allMessages[i].type === 'topic-break') { startIdx = i + 1; break; }
  }
  const topicMessages = allMessages.slice(startIdx, endIdx + 1).filter(m => m.type !== 'topic-break');
  if (topicMessages.length === 0) return null;

  const convo = await Promise.all(topicMessages.map(async m => {
    const u = await findUserById(m.senderId);
    return `[${u?.nickname || m.senderId}]: ${m.text}`;
  }));

  const participants = await Promise.all(room.participants.map(id => findUserById(id)));
  const names = participants.map(u => u?.nickname || u?.id || 'User').join(' 和 ');

  const resp = await openrouter.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: `You are BridgeIt. Summarize what ${names} mutually understood in this conversation topic in 1-2 warm sentences. Start with "在这段对话里" if Chinese is dominant, or "In this conversation" if English. Focus on what they understood about each other, not what happened.` },
      { role: 'user', content: `Conversation:\n${convo.join('\n')}\n\nWrite the mutual understanding summary.` },
    ],
    temperature: 0.6,
  });
  return resp.choices[0].message.content.trim();
}
```

**Step 2：手动验证**

`node -e "require('./server')"` 应无语法错误（Ctrl+C 退出）。

**Step 3：提交**

```bash
git add server.js
git commit -m "feat: add updateRoomMemory, updateRelationshipProfile, getTopicSummary to server"
```

---

### Task 2：server.js — `new-topic-break` 触发话题收尾 AI

**Files:**
- Modify: `server.js`（第 599-612 行，`new-topic-break` handler）

**Step 1：替换 `new-topic-break` handler**

找到：
```javascript
  socket.on('new-topic-break', async ({ roomId }, cb) => {
    const room = await getRoomById(roomId);
    if (!room || !room.participants.includes(socket.userId)) return;
    const breakMsg = {
      id: ++messageIdCounter,
      roomId,
      conversationId: roomId,
      type: 'topic-break',
      timestamp: Date.now(),
    };
    await saveMessage(breakMsg);
    io.to(roomId).emit('topic-break', breakMsg);
    cb?.({ ok: true });
  });
```

替换为：
```javascript
  socket.on('new-topic-break', async ({ roomId }, cb) => {
    const room = await getRoomById(roomId);
    if (!room || !room.participants.includes(socket.userId)) return;

    // 先生成话题收尾摘要（在 break 消息之前取消息）
    let topicSummary = null;
    try {
      topicSummary = await getTopicSummary(roomId, room);
    } catch (e) { console.error('getTopicSummary error:', e.message); }

    const breakMsg = {
      id: ++messageIdCounter,
      roomId,
      conversationId: roomId,
      type: 'topic-break',
      timestamp: Date.now(),
    };
    await saveMessage(breakMsg);

    // 发送话题收尾卡片（如果有摘要）
    if (topicSummary) {
      io.to(roomId).emit('topic-summary', {
        roomId,
        summary: topicSummary,
        timestamp: breakMsg.timestamp,
      });
      await updateRoomMemory(roomId, topicSummary);
    }

    io.to(roomId).emit('topic-break', breakMsg);
    cb?.({ ok: true });
  });
```

**Step 2：验证**

启动 `node server.js`，打开两个浏览器窗口登录，发几条消息后点换话题，观察控制台无 unhandled error。

**Step 3：提交**

```bash
git add server.js
git commit -m "feat: trigger topic summary AI on new-topic-break"
```

---

### Task 3：server.js — 注入记忆到 AI 分析 prompt

**Files:**
- Modify: `server.js`（`buildSystemPrompt` 函数，第 389 行；`getAIAnalysis` 函数，第 619 行）

**Step 1：修改 `buildSystemPrompt` 接受 memory 参数**

找到：
```javascript
function buildSystemPrompt(senderNickname, receiverNickname, translateTo) {
```

替换为：
```javascript
function buildSystemPrompt(senderNickname, receiverNickname, translateTo, memory = null) {
```

找到（函数末尾 return 语句的结尾，第 426 行）：
```javascript
- Never take sides. Focus on the emotional gap.
- Respond in the language the receiver is most likely comfortable with for insight/advice.`;
}
```

替换为：
```javascript
- Never take sides. Focus on the emotional gap.
- Respond in the language the receiver is most likely comfortable with for insight/advice.${memory ? `

【Relationship Context】
${memory}` : ''}`;
}
```

**Step 2：修改 `getAIAnalysis` 传入 memory**

找到：
```javascript
  const translateTo = getAllTranslateTo(room);
  const systemPrompt = buildSystemPrompt(senderName, receiverName, translateTo);
```

替换为：
```javascript
  const translateTo = getAllTranslateTo(room);
  // 构建记忆上下文
  let memory = null;
  const history = (room.topicHistory || []).slice(-5);
  if (history.length > 0 || room.relationshipProfile) {
    const parts = [];
    if (room.relationshipProfile) parts.push(`Relationship profile: ${room.relationshipProfile}`);
    if (history.length > 0) {
      parts.push('Recent topic summaries:\n' + history.map(h => `- ${h.summary}`).join('\n'));
    }
    memory = parts.join('\n');
  }
  const systemPrompt = buildSystemPrompt(senderName, receiverName, translateTo, memory);
```

**Step 3：提交**

```bash
git add server.js
git commit -m "feat: inject topic history and relationship profile into AI analysis prompt"
```

---

### Task 4：server.js — GET /rooms/:roomId/journal API

**Files:**
- Modify: `server.js`（在 `PATCH /rooms/:roomId/translate` 之后添加）

**Step 1：找到位置**

找到（第 ~538 行）：
```javascript
  res.json({ ok: true });
});

```
（这是 `PATCH /rooms/:roomId/translate` 的结尾）

在其后追加：
```javascript
app.get('/rooms/:roomId/journal', authMiddleware, async (req, res) => {
  const room = await getRoomById(req.params.roomId);
  if (!room || !room.participants.includes(req.userId)) return res.status(403).json({ error: 'Forbidden' });
  const partnerId = room.participants.find(id => id !== req.userId);
  const partner = await findUserById(partnerId);
  res.json({
    topicHistory: (room.topicHistory || []).slice().reverse(), // newest first
    relationshipProfile: room.relationshipProfile || null,
    partnerName: partner?.nickname || partner?.contactId || '对方',
  });
});
```

**Step 2：提交**

```bash
git add server.js
git commit -m "feat: add GET /rooms/:roomId/journal API endpoint"
```

---

### Task 5：chat.html — Bridge Moment CSS + socket 事件 + 📖 按钮

**Files:**
- Modify: `public/chat.html`

**Step 1：在 `</style>` 之前添加 Bridge Moment CSS**

找到：
```css
    .bridge-status.dim { opacity: 0.3; }
  </style>
```

替换为：
```css
    .bridge-status.dim { opacity: 0.3; }
    .bridge-moment { margin: 4px 10px 12px; padding: 13px 15px; position: relative; z-index: 1; background: rgba(92,107,192,0.1); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid rgba(179,136,255,0.25); border-radius: 18px; box-shadow: 0 4px 20px rgba(92,107,192,0.1); animation: fadeUp 0.4s ease; }
    .bm-top { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
    .bm-orb { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, #9C27B0, #5C6BC0); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; box-shadow: 0 0 12px rgba(92,107,192,0.4); }
    .bm-lbl { font-size: 0.63rem; font-weight: 700; color: rgba(179,136,255,0.9); text-transform: uppercase; letter-spacing: 0.8px; }
    .bm-text { font-size: 0.84rem; color: rgba(255,255,255,0.82); line-height: 1.55; }
    .bm-time { font-size: 0.6rem; color: rgba(255,255,255,0.2); text-align: right; margin-top: 6px; }
  </style>
```

**Step 2：在 topbar 📖 按钮**

找到：
```html
  <button class="topbar-btn" onclick="openSettingsDrawer()" title="聊天设置">⚙️</button>
```

替换为：
```html
  <button class="topbar-btn" onclick="openJournal()" title="Bridge 日志">📖</button>
  <button class="topbar-btn" onclick="openSettingsDrawer()" title="聊天设置">⚙️</button>
```

**Step 3：在 script 块添加 `openJournal` 函数和 `topic-summary` socket 事件**

找到：
```javascript
socket.on('topic-break', msg => { if (msg.roomId === roomId) renderItem(msg, true); });
```

替换为：
```javascript
socket.on('topic-break', msg => { if (msg.roomId === roomId) renderItem(msg, true); });
socket.on('topic-summary', data => {
  if (data.roomId !== roomId) return;
  renderBridgeMoment(data.summary, data.timestamp);
});
```

找到（在 `renderBridgeStatus` 函数之后）：
```javascript
function renderAICard(analysis) {
```

在其**前面**插入：
```javascript
function renderBridgeMoment(summary, timestamp) {
  const wrap = document.getElementById('chat-wrap');
  const card = document.createElement('div');
  card.className = 'bridge-moment';
  const t = new Date(timestamp);
  const timeStr = `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  card.innerHTML = `
    <div class="bm-top">
      <div class="bm-orb">🌉</div>
      <div class="bm-lbl">Bridge Moment</div>
    </div>
    <div class="bm-text">${escHtml(summary)}</div>
    <div class="bm-time">${timeStr}</div>`;
  wrap.appendChild(card);
  scrollToBottom();
}

function openJournal() {
  window.location.href = '/journal.html?room=' + encodeURIComponent(roomId);
}

```

**Step 4：手动验证**

1. 打开聊天页 → topbar 有 📖 和 ⚙️ 两个按钮
2. 发几条消息 → 点换话题 → 等待 2-5 秒
3. 聊天区出现蓝紫色 Bridge Moment 卡片（在分割线上方）
4. 点 📖 → 跳转到 `/journal.html?room=...`（暂时 404，下一 Task 会创建）

**Step 5：提交**

```bash
git add public/chat.html
git commit -m "feat: add Bridge Moment card and journal button to chat.html"
```

---

### Task 6：journal.html — Bridge 日志页面

**Files:**
- Create: `public/journal.html`

**Step 1：创建文件**

创建 `/Users/celestevega/Desktop/Bridge_it/bridgeit/public/journal.html`，内容如下：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bridge 日志</title>
  <link rel="stylesheet" href="/css/mobile.css">
  <style>
    body { background: var(--dark-bg); overflow-y: auto; }
    .bg-wrap { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
    .blob { position: absolute; border-radius: 50%; }
    .blob-purple { width: 320px; height: 320px; top: -80px; left: -80px; background: radial-gradient(circle, rgba(123,31,162,0.38) 0%, transparent 68%); animation: blobFloat1 16s ease-in-out infinite; }
    .blob-yellow { width: 280px; height: 280px; bottom: 60px; right: -60px; background: radial-gradient(circle, rgba(255,179,0,0.28) 0%, transparent 68%); animation: blobFloat2 20s ease-in-out infinite; }

    .topbar { position: fixed; top: 0; left: 0; right: 0; height: 60px; background: rgba(13,13,26,0.75); backdrop-filter: blur(32px) saturate(180%); -webkit-backdrop-filter: blur(32px) saturate(180%); border-bottom: 1px solid rgba(255,255,255,0.07); display: flex; align-items: center; padding: 0 18px; gap: 10px; z-index: 100; }
    .back-btn { color: rgba(255,255,255,0.55); font-size: 1rem; background: none; border: none; cursor: pointer; font-family: inherit; }
    .topbar-title { flex: 1; text-align: center; font-weight: 700; font-size: 1rem; color: white; }

    .content { padding: 76px 16px 32px; position: relative; z-index: 1; }

    .profile-card { background: rgba(92,107,192,0.1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(179,136,255,0.2); border-radius: 20px; padding: 16px 18px; margin-bottom: 24px; }
    .profile-title { font-size: 0.65rem; font-weight: 700; color: rgba(179,136,255,0.7); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
    .profile-text { font-size: 0.88rem; color: rgba(255,255,255,0.8); line-height: 1.6; }
    .profile-empty { font-size: 0.82rem; color: rgba(255,255,255,0.25); font-style: italic; }

    .section-label { font-size: 0.65rem; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; padding-left: 2px; }

    .moment-card { background: rgba(255,255,255,0.05); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.09); border-radius: 16px; padding: 14px 16px; margin-bottom: 10px; }
    .moment-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .moment-orb { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #9C27B0, #5C6BC0); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; flex-shrink: 0; }
    .moment-lbl { font-size: 0.6rem; font-weight: 700; color: rgba(179,136,255,0.7); text-transform: uppercase; letter-spacing: 0.5px; flex: 1; }
    .moment-time { font-size: 0.6rem; color: rgba(255,255,255,0.2); }
    .moment-text { font-size: 0.85rem; color: rgba(255,255,255,0.82); line-height: 1.55; }

    .empty-state { text-align: center; padding: 48px 24px; color: rgba(255,255,255,0.25); font-size: 0.88rem; }
    .loading { text-align: center; padding: 48px 24px; color: rgba(255,255,255,0.3); font-size: 0.88rem; }
  </style>
</head>
<body>
<div class="bg-wrap">
  <div class="blob blob-purple"></div>
  <div class="blob blob-yellow"></div>
</div>

<div class="topbar">
  <button class="back-btn" onclick="history.back()">‹ 返回</button>
  <div class="topbar-title">🌉 Bridge 日志</div>
  <div style="width:40px"></div>
</div>

<div class="content" id="content">
  <div class="loading">加载中…</div>
</div>

<script>
const token = localStorage.getItem('bridgeit_token');
if (!token) window.location.href = '/login.html';

const params = new URLSearchParams(location.search);
const roomId = params.get('room');
if (!roomId) window.location.href = '/home.html';

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function load() {
  try {
    const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/journal`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) { document.getElementById('content').innerHTML = '<div class="empty-state">加载失败，请返回重试。</div>'; return; }
    const data = await res.json();
    render(data);
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="empty-state">加载失败，请检查网络连接。</div>';
  }
}

function render({ topicHistory, relationshipProfile, partnerName }) {
  let html = '';

  // 关系画像
  html += `<div class="profile-card">
    <div class="profile-title">关系画像 · 与 ${escHtml(partnerName)}</div>`;
  if (relationshipProfile) {
    html += `<div class="profile-text">${escHtml(relationshipProfile)}</div>`;
  } else {
    html += `<div class="profile-empty">积累 5 段话题后，AI 将生成你们的关系画像。</div>`;
  }
  html += `</div>`;

  // 时间线
  html += `<div class="section-label">对话时刻</div>`;
  if (!topicHistory || topicHistory.length === 0) {
    html += `<div class="empty-state">换话题时，Bridge 会记录你们相互理解的瞬间。</div>`;
  } else {
    topicHistory.forEach(item => {
      html += `<div class="moment-card">
        <div class="moment-header">
          <div class="moment-orb">🌉</div>
          <div class="moment-lbl">Bridge Moment</div>
          <div class="moment-time">${escHtml(formatDate(item.timestamp))}</div>
        </div>
        <div class="moment-text">${escHtml(item.summary)}</div>
      </div>`;
    });
  }

  document.getElementById('content').innerHTML = html;
}

load();
</script>
</body>
</html>
```

**Step 2：手动验证**

1. 打开聊天页，换几次话题后点 📖
2. 日志页加载，显示关系画像占位文字（首次）
3. 时间线显示每次换话题的 Bridge Moment 摘要

**Step 3：提交**

```bash
git add public/journal.html
git commit -m "feat: add Bridge Journal page (journal.html)"
```

---

### Task 7：推送并线上验证

**Step 1：推送**

```bash
git push origin main
```

**Step 2：Render 部署后完整验证**

1. 两个账号进入同一聊天室，发几条消息
2. 点"换新话题" → Bridge Moment 卡片（蓝紫色）出现在分割线上方
3. 点 📖 → 日志页显示该 Moment
4. 累计 5 次换话题 → 关系画像自动生成
5. 继续发消息 → AI 分析的洞察更加贴合两人关系（内存注入生效）

---
