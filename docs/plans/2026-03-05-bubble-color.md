# 对方气泡颜色自定义 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在聊天页将 🌐 翻译按钮改为 ⚙️ 设置入口，整合翻译设置和对方气泡颜色选择器。

**Architecture:** 纯前端改动，颜色存 localStorage，CSS variable `--partner-bubble` 控制 `.theirs .bubble` 背景色；翻译抽屉扩展为综合设置抽屉，保留原有翻译逻辑不变。

**Tech Stack:** Vanilla JS, CSS variables, localStorage, native `<input type="color">`, i18n.js (已有)

---

### Task 1：i18n.js — 新增 3 个 key × 5 种语言

**Files:**
- Modify: `public/js/i18n.js`

**Step 1：在每个语言区块的末尾（`contact_id_own_ph` 行后面）添加 3 个新 key**

在 `zh` 区块的 `contact_id_own_ph` 行后面添加：
```javascript
chat_settings: '聊天设置',
partner_bubble_color: '对方气泡颜色',
reset_default: '恢复默认',
```

在 `en` 区块添加：
```javascript
chat_settings: 'Chat Settings',
partner_bubble_color: 'Partner Bubble Color',
reset_default: 'Reset Default',
```

在 `es` 区块添加：
```javascript
chat_settings: 'Ajustes del chat',
partner_bubble_color: 'Color de burbuja',
reset_default: 'Restablecer',
```

在 `ru` 区块添加：
```javascript
chat_settings: 'Настройки чата',
partner_bubble_color: 'Цвет пузыря собеседника',
reset_default: 'По умолчанию',
```

在 `fr` 区块添加：
```javascript
chat_settings: 'Paramètres du chat',
partner_bubble_color: 'Couleur des bulles',
reset_default: 'Réinitialiser',
```

**Step 2：验证**

打开浏览器控制台：
```javascript
localStorage.setItem('bridgeit_lang','en');
// 刷新后
T('partner_bubble_color') // → "Partner Bubble Color"
T('reset_default')        // → "Reset Default"
T('chat_settings')        // → "Chat Settings"
```

**Step 3：提交**

```bash
git add public/js/i18n.js
git commit -m "feat: add chat settings i18n keys (3 keys × 5 langs)"
```

---

### Task 2：chat.html — CSS 变量 + 样式

**Files:**
- Modify: `public/chat.html` (lines 9-142, `<style>` block)

**Step 1：在 `<style>` 块顶部（第 9 行 `<style>` 标签之后）添加 CSS 变量**

找到：
```css
  <style>
    .chat-wrap {
```

替换为：
```css
  <style>
    :root { --partner-bubble: #ffffff; }
    .chat-wrap {
```

**Step 2：将 `.theirs .bubble` 的 `background: white` 改为 CSS 变量**

找到（第 32-33 行区域）：
```css
    .theirs .bubble { background: white; color: var(--text); border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
```

替换为：
```css
    .theirs .bubble { background: var(--partner-bubble); color: var(--text); border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
```

**Step 3：在 `<style>` 块末尾（`</style>` 标签前）添加颜色行样式**

找到：
```css
    .tl-empty { color: #CCC; font-size: 0.82rem; text-align: center; padding: 12px 0 4px; }
  </style>
```

替换为：
```css
    .tl-empty { color: #CCC; font-size: 0.82rem; text-align: center; padding: 12px 0 4px; }

    .color-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; margin-top: 4px; }
    .color-row input[type=color] { width: 44px; height: 44px; border: 1.5px solid var(--border); border-radius: 10px; cursor: pointer; padding: 2px; background: none; }
    .reset-color-btn { background: none; border: 1.5px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 0.82rem; color: #999; cursor: pointer; }
    .reset-color-btn:active { background: var(--bg); }
  </style>
```

**Step 4：手动验证 CSS**

打开 chat.html，检查：
- 浏览器 DevTools 中 `.theirs .bubble` 的 `background` 应为 `var(--partner-bubble)`
- `:root` 中 `--partner-bubble` 值为 `#ffffff`（与原来白色一致，视觉无变化）

**Step 5：提交**

```bash
git add public/chat.html
git commit -m "feat: add --partner-bubble CSS variable to chat bubbles"
```

---

### Task 3：chat.html — HTML 结构改动

**Files:**
- Modify: `public/chat.html` (lines 146-169, `<body>` 上半部分)

**Step 1：将 topbar 按钮 🌐 改为 ⚙️ 并更新函数名**

找到（第 149 行）：
```html
  <button class="topbar-btn" onclick="openTranslateDrawer()" title="翻译设置">🌐</button>
```

替换为：
```html
  <button class="topbar-btn" onclick="openSettingsDrawer()" title="聊天设置">⚙️</button>
```

**Step 2：更新抽屉 overlay 及内容**

找到（第 163-169 行）：
```html
<div class="drawer-overlay" id="drawer-overlay" onclick="closeTranslateDrawer()">
  <div class="drawer" onclick="event.stopPropagation()">
    <h3 data-i18n="msg_translate">消息翻译</h3>
    <div id="translate-drawer-content"></div>
    <button class="btn-primary" onclick="saveTranslate()" data-i18n="save">保存</button>
  </div>
</div>
```

替换为：
```html
<div class="drawer-overlay" id="drawer-overlay" onclick="closeSettingsDrawer()">
  <div class="drawer" onclick="event.stopPropagation()">
    <h3 data-i18n="chat_settings">聊天设置</h3>
    <div id="translate-drawer-content"></div>
    <div class="tl-section-label" style="margin-top:20px" data-i18n="partner_bubble_color">对方气泡颜色</div>
    <div class="color-row">
      <input type="color" id="partner-color-input" value="#ffffff"
        oninput="document.documentElement.style.setProperty('--partner-bubble', this.value)">
      <button class="reset-color-btn" onclick="resetColor()" data-i18n="reset_default">恢复默认</button>
    </div>
    <button class="btn-primary" onclick="saveSettings()" data-i18n="save">保存</button>
  </div>
</div>
```

**Step 3：手动验证 HTML**

打开页面，点 ⚙️：
- 抽屉弹出，标题为"聊天设置"（或当前语言对应翻译）
- 显示翻译语言区域（与之前完全一致）
- 下方显示"对方气泡颜色"标签 + 颜色选择器 + "恢复默认"按钮
- 点颜色选择器可选色，气泡实时变色

**Step 4：提交**

```bash
git add public/chat.html
git commit -m "feat: update chat topbar to settings drawer with color picker HTML"
```

---

### Task 4：chat.html — JS 逻辑

**Files:**
- Modify: `public/chat.html` (script block, ~line 171+)

**Step 1：在 `let translateTo = [];` 行后（第 197 行附近）添加颜色状态变量和初始化**

找到：
```javascript
let translateTo = [];
```

替换为：
```javascript
let translateTo = [];
let _savedPartnerColor = '#ffffff';

function loadPartnerColor() {
  const c = localStorage.getItem('bridgeit_partner_color') || '#ffffff';
  _savedPartnerColor = c;
  document.documentElement.style.setProperty('--partner-bubble', c);
}
loadPartnerColor();
```

**Step 2：将 `openTranslateDrawer` 重命名为 `openSettingsDrawer`，并在打开时初始化颜色选择器**

找到：
```javascript
async function openTranslateDrawer() {
  await loadRoomConfig();
  renderTranslateDrawer();
  document.getElementById('drawer-overlay').classList.add('open');
}
```

替换为：
```javascript
async function openSettingsDrawer() {
  await loadRoomConfig();
  _savedPartnerColor = localStorage.getItem('bridgeit_partner_color') || '#ffffff';
  renderTranslateDrawer();
  document.getElementById('drawer-overlay').classList.add('open');
  const input = document.getElementById('partner-color-input');
  if (input) input.value = _savedPartnerColor;
  applyI18n();
}
```

**Step 3：将 `closeTranslateDrawer` 重命名为 `closeSettingsDrawer`，并还原未保存的颜色**

找到：
```javascript
function closeTranslateDrawer() { document.getElementById('drawer-overlay').classList.remove('open'); }
```

替换为：
```javascript
function closeSettingsDrawer() {
  document.documentElement.style.setProperty('--partner-bubble', _savedPartnerColor);
  document.getElementById('drawer-overlay').classList.remove('open');
}
```

**Step 4：添加 `resetColor` 函数（放在 `closeSettingsDrawer` 之后）**

找到：
```javascript
function renderTranslateDrawer() {
```

在其前面插入（即在 `closeSettingsDrawer` 和 `renderTranslateDrawer` 之间）：
```javascript
function resetColor() {
  document.getElementById('partner-color-input').value = '#ffffff';
  document.documentElement.style.setProperty('--partner-bubble', '#ffffff');
}

```

**Step 5：将 `saveTranslate` 替换为 `saveSettings`，同时保存颜色**

找到：
```javascript
async function saveTranslate() {
  // Read current order from DOM
  const items = document.querySelectorAll('#tl-order-list .tl-item');
  translateTo = [...items].map(el => el.dataset.lang);
  try {
    await fetch(`/rooms/${roomId}/translate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ translateTo }),
    });
    closeTranslateDrawer();
  } catch (e) { alert(T('save_failed')); }
}
```

替换为：
```javascript
async function saveSettings() {
  // Save translation order from DOM
  const items = document.querySelectorAll('#tl-order-list .tl-item');
  translateTo = [...items].map(el => el.dataset.lang);

  // Save partner bubble color
  const colorInput = document.getElementById('partner-color-input');
  const color = colorInput ? colorInput.value : '#ffffff';
  localStorage.setItem('bridgeit_partner_color', color);
  document.documentElement.style.setProperty('--partner-bubble', color);
  _savedPartnerColor = color;

  try {
    await fetch(`/rooms/${roomId}/translate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ translateTo }),
    });
    closeSettingsDrawer();
  } catch (e) { alert(T('save_failed')); }
}
```

**Step 6：手动验证完整功能**

1. 打开聊天页，点 ⚙️ → 抽屉打开
2. 颜色选择器显示当前颜色（默认 #ffffff）
3. 拖动颜色选择器 → 对方气泡实时变色
4. 点"恢复默认"→ 颜色重置为白色
5. 点保存 → 抽屉关闭，气泡保持新颜色
6. 刷新页面 → 颜色保持（从 localStorage 读回）
7. 打开抽屉，选择新颜色但不保存，直接点抽屉外关闭 → 颜色恢复到保存前的值
8. 翻译语言设置功能正常，拖排序仍然有效

**Step 7：提交**

```bash
git add public/chat.html
git commit -m "feat: add partner bubble color picker to chat settings drawer"
```

---

### Task 5：推送并验证线上

**Step 1：推送**

```bash
git push origin main
```

**Step 2：等待 Render 部署后验证**

1. 打开聊天页 → ⚙️ 按钮可见
2. 点 ⚙️ → 设置抽屉显示翻译区 + 颜色区
3. 选择颜色 → 保存 → 刷新 → 颜色持久
4. 翻译功能不受影响

---
