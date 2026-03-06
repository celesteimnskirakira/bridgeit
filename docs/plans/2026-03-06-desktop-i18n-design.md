# 设计文档：桌面侧边栏 + i18n 语言切换

**日期**：2026-03-06
**状态**：已批准，待实施

---

## 设计目标

1. 语言切换在所有页面正常工作（login/register/chat/home）
2. 桌面端 ≥768px 显示侧边栏布局（左侧联系人 + 右侧聊天）；移动端行为不变

---

## 功能一：i18n 语言切换完整实现

### 问题
- `login.html` 无语言选择 UI
- `chat.html` 设置抽屉无语言切换
- `i18n.js` 缺少键：`chat_settings`、`partner_bubble_color`、`reset_default`

### 修复

**i18n.js** — 补全 5 种语言的缺失键：
```
chat_settings: '聊天设置' / 'Chat Settings' / ...
partner_bubble_color: '对方气泡颜色' / 'Partner Bubble Color' / ...
reset_default: '恢复默认' / 'Reset' / ...
display_language: '界面语言' / 'Display Language' / ...
```

**login.html** — 在 `.login-card` 上方（`.login-slogan` 下方）加旗帜条：
```html
<div class="lang-strip" id="lang-strip">
  <button class="lang-strip-btn" data-lang="zh" onclick="switchLang('zh')">🇨🇳</button>
  ...（与 register.html 完全一致）
</div>
```
CSS 复用 register.html 的 `.lang-strip` / `.lang-strip-btn` / `.lang-strip-btn.active` 样式。
JS 加 `switchLang()` + `updateLangStrip()` 函数（与 register.html 完全一致）。

**chat.html** — 设置抽屉内（保存按钮上方）加语言网格：
```html
<div class="tl-section-label" data-i18n="display_language">界面语言</div>
<div class="lang-grid" id="chat-lang-grid">
  <button class="lang-btn" data-lang="zh" onclick="setChatLang('zh')">🇨🇳 中文</button>
  <button class="lang-btn" data-lang="en" onclick="setChatLang('en')">🇺🇸 English</button>
  <button class="lang-btn" data-lang="es" onclick="setChatLang('es')">🇪🇸 Español</button>
  <button class="lang-btn" data-lang="ru" onclick="setChatLang('ru')">🇷🇺 Русский</button>
  <button class="lang-btn" data-lang="fr" onclick="setChatLang('fr')">🇫🇷 Français</button>
</div>
```
`setChatLang(code)` 函数：`localStorage.setItem('bridgeit_lang', code)` + `applyI18n()` + 更新高亮。
`openSettingsDrawer()` 中调用 `updateChatLangGrid()` 更新当前高亮。

---

## 功能二：桌面侧边栏布局

### 架构

| 设备 | 行为 |
|---|---|
| 移动端（< 768px） | 不变：home.html 列表 → 点击跳转 chat.html |
| 桌面端（≥ 768px） | home.html 双栏：左侧 320px + 右侧 iframe |

### home.html 桌面布局

```
┌──────────────────────────────────────────────────────┐
│  topbar (全宽)                                        │
├──────────────────┬───────────────────────────────────┤
│  .sidebar (320px)│  .main-panel (flex: 1)            │
│                  │                                   │
│  联系人列表      │  <iframe id="chat-frame">          │
│  (现有 room-list) │  初始：欢迎占位屏                 │
│                  │                                   │
│  [+ FAB]         │                                   │
└──────────────────┴───────────────────────────────────┘
```

**CSS（mobile.css 中加 @media）：**
```css
@media (min-width: 768px) {
  .desktop-shell { display: flex; height: 100vh; }
  .sidebar { width: 320px; flex-shrink: 0; border-right: 1px solid var(--glass-border); overflow-y: auto; }
  .main-panel { flex: 1; position: relative; }
  .chat-frame { width: 100%; height: 100%; border: none; }
}
```

**home.html JS 修改：**
```javascript
// enterRoom 函数修改
function enterRoom(roomId, partnerName) {
  localStorage.setItem('bridgeit_current_room', roomId);
  localStorage.setItem('bridgeit_partner_name', partnerName);
  if (window.innerWidth >= 768) {
    // 桌面：加载到 iframe
    document.getElementById('chat-frame').src = `/chat.html?room=${encodeURIComponent(roomId)}&embedded=1`;
    // 高亮选中的房间卡片
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.room-item[data-room="${roomId}"]`)?.classList.add('active');
  } else {
    // 移动：跳转
    window.location.href = `/chat.html?room=${encodeURIComponent(roomId)}`;
  }
}
```

**home.html HTML 包装（桌面模式）：**
在 `<body>` 内，将现有内容包进 `.sidebar`，右侧加 `.main-panel`，整体套 `.desktop-shell`。

**欢迎占位屏（iframe 初始状态）：**
```html
<div class="welcome-placeholder" id="welcome-placeholder">
  <div class="wp-icon">🌉</div>
  <div class="wp-title">BridgeIt</div>
  <div class="wp-hint">选择一个对话开始</div>
</div>
```

### chat.html embedded 模式

检测 `?embedded=1` URL 参数：
```javascript
const isEmbedded = new URLSearchParams(location.search).get('embedded') === '1';
if (isEmbedded) {
  document.querySelector('.back-btn').style.display = 'none';
}
```

### 联系人卡片 active 状态 CSS
```css
@media (min-width: 768px) {
  .room-item.active { background: rgba(156,39,176,0.15); border-color: rgba(179,136,255,0.4); }
}
```

---

## 受影响文件

| 文件 | 改动类型 |
|---|---|
| `public/js/i18n.js` | 补全缺失 i18n 键 |
| `public/login.html` | 加旗帜条语言选择 |
| `public/chat.html` | 设置抽屉加语言网格；加 embedded 模式 |
| `public/css/mobile.css` | 加 @media ≥768px 桌面布局 |
| `public/home.html` | 桌面双栏 HTML 结构；修改 enterRoom；欢迎占位屏 |

---

## 不在本次范围内
- 桌面端 URL 同步（刷新后恢复选中房间）
- register.html 语言切换（已实现）
- journal.html 语言切换 UI（已有 applyI18n，不需要额外按钮）
