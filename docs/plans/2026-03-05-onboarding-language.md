# Onboarding Language Switcher + Empty State Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在注册页顶部加旗帜语言切换条（点击立即生效），并将主页空状态替换为含联系号复制的三步引导卡片。

**Architecture:** 纯前端改动，无需服务端变更。语言切换复用已有 `getLang()` / `applyI18n()` / `T()` 体系；空状态卡片在 `renderRooms()` 函数的空分支中渲染，直接嵌入当前用户联系号。

**Tech Stack:** Vanilla JS, CSS (mobile.css 变量), i18n.js (已有)

---

### Task 1：i18n.js — 新增 5 个 key × 5 种语言

**Files:**
- Modify: `public/js/i18n.js`

**Step 1：在 zh 区块末尾（knowledge_bridge 行后面）添加新 key**

在每个语言区块的 `knowledge_bridge` 行后面添加：

```javascript
// zh
welcome_title: '欢迎使用 BridgeIt 👋',
your_contact_id: '你的联系号',
copied: '已复制 ✓',
share_hint: '把联系号发给想聊天的朋友',
add_hint: '点右下角 + 输入对方联系号，立即开始对话',

// en
welcome_title: 'Welcome to BridgeIt 👋',
your_contact_id: 'Your Contact ID',
copied: 'Copied ✓',
share_hint: 'Share your ID with a friend',
add_hint: 'Tap + and enter their ID to start chatting',

// es
welcome_title: '¡Bienvenido a BridgeIt 👋',
your_contact_id: 'Tu ID de contacto',
copied: 'Copiado ✓',
share_hint: 'Comparte tu ID con un amigo',
add_hint: 'Toca + e ingresa su ID para empezar a chatear',

// ru
welcome_title: 'Добро пожаловать в BridgeIt 👋',
your_contact_id: 'Ваш ID контакта',
copied: 'Скопировано ✓',
share_hint: 'Поделитесь ID с другом',
add_hint: 'Нажмите + и введите ID друга, чтобы начать',

// fr
welcome_title: 'Bienvenue sur BridgeIt 👋',
your_contact_id: 'Votre identifiant',
copied: 'Copié ✓',
share_hint: 'Partagez votre identifiant avec un ami',
add_hint: 'Appuyez sur + et entrez son identifiant pour commencer',
```

**Step 2：验证**

打开浏览器控制台执行：
```javascript
// 切换到 en 后检查新 key
localStorage.setItem('bridgeit_lang','en');
// 刷新任意页面后在控制台
T('welcome_title') // 应返回 "Welcome to BridgeIt 👋"
T('copied')        // 应返回 "Copied ✓"
```

**Step 3：提交**

```bash
git add public/js/i18n.js
git commit -m "feat: add onboarding i18n keys (5 langs)"
```

---

### Task 2：register.html — 注册卡片顶部加语言切换条

**Files:**
- Modify: `public/register.html`

**Step 1：在 `<style>` 块末尾添加 CSS**

```css
.lang-strip {
  display: flex; justify-content: center; gap: 8px; margin-bottom: 20px;
}
.lang-strip-btn {
  width: 36px; height: 36px; border-radius: 50%;
  border: 2px solid transparent; background: none;
  font-size: 1.25rem; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.lang-strip-btn.active {
  border-color: var(--purple); background: var(--purple-bg);
}
```

**Step 2：在 `.login-card` 内、`.logo` div 上方插入语言切换条 HTML**

```html
<div class="lang-strip" id="lang-strip">
  <button class="lang-strip-btn" data-lang="zh" onclick="switchLang('zh')">🇨🇳</button>
  <button class="lang-strip-btn" data-lang="en" onclick="switchLang('en')">🇺🇸</button>
  <button class="lang-strip-btn" data-lang="es" onclick="switchLang('es')">🇪🇸</button>
  <button class="lang-strip-btn" data-lang="ru" onclick="switchLang('ru')">🇷🇺</button>
  <button class="lang-strip-btn" data-lang="fr" onclick="switchLang('fr')">🇫🇷</button>
</div>
```

**Step 3：在 `<script>` 块中（`applyI18n()` 调用之后）添加初始化和切换函数**

```javascript
// 初始化高亮当前语言
function updateLangStrip() {
  const cur = getLang();
  document.querySelectorAll('.lang-strip-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === cur);
  });
}

function switchLang(code) {
  localStorage.setItem('bridgeit_lang', code);
  applyI18n();
  updateLangStrip();
}

updateLangStrip();
```

**Step 4：手动验证**

1. 打开 `/register.html`
2. 确认旗帜条显示在 logo 上方，当前语言高亮
3. 点击 🇺🇸 → 页面所有文字（昵称、联系号、PIN 标签、按钮）立即变为英文
4. 点击 🇨🇳 → 立即恢复中文
5. 刷新页面 → 上次选择的语言保持

**Step 5：提交**

```bash
git add public/register.html
git commit -m "feat: add language switcher strip to register page"
```

---

### Task 3：home.html — 替换空状态为三步引导卡片

**Files:**
- Modify: `public/home.html`

**Step 1：在 `<style>` 块末尾添加空状态卡片 CSS**

```css
.onboarding-card {
  margin: 24px 16px; background: white;
  border-radius: 20px; padding: 24px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.07);
}
.onboarding-title {
  font-size: 1.05rem; font-weight: 700;
  color: var(--text); margin-bottom: 20px; text-align: center;
}
.onboarding-step {
  display: flex; align-items: flex-start; gap: 14px;
  margin-bottom: 18px;
}
.onboarding-step:last-child { margin-bottom: 0; }
.step-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--purple-bg); color: var(--purple);
  font-weight: 700; font-size: 0.82rem; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.step-body { flex: 1; }
.step-label {
  font-size: 0.82rem; color: #999; margin-bottom: 4px;
}
.step-content { font-size: 0.9rem; color: var(--text); line-height: 1.4; }
.contact-id-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--purple-bg); color: var(--purple);
  border-radius: 20px; padding: 4px 12px;
  font-weight: 700; font-size: 0.9rem; cursor: pointer;
  border: none; margin-top: 4px; transition: opacity 0.15s;
}
.contact-id-chip:active { opacity: 0.7; }
.step-action {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--purple); font-size: 0.88rem;
  font-weight: 600; cursor: pointer; margin-top: 6px;
  background: none; border: none; padding: 0;
}
```

**Step 2：找到 `renderRooms` 函数中的空状态分支，替换为新的卡片渲染**

旧代码（找到并替换）：
```javascript
if (rooms.length === 0) {
  list.innerHTML = `<div class="empty-state"><h3>${escHtml(T('no_conversations'))}</h3><p>${escHtml(T('add_friend_hint'))}</p></div>`;
  return;
}
```

新代码：
```javascript
if (rooms.length === 0) {
  const contactId = user.contactId ? '#' + user.contactId : '';
  list.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-title">${escHtml(T('welcome_title'))}</div>
      <div class="onboarding-step">
        <div class="step-num">1</div>
        <div class="step-body">
          <div class="step-label">${escHtml(T('your_contact_id'))}</div>
          <button class="contact-id-chip" onclick="copyContactId(this, '${escHtml(user.contactId || '')}')">
            ${escHtml(contactId)} <span>📋</span>
          </button>
        </div>
      </div>
      <div class="onboarding-step">
        <div class="step-num">2</div>
        <div class="step-body">
          <div class="step-content">${escHtml(T('share_hint'))}</div>
        </div>
      </div>
      <div class="onboarding-step">
        <div class="step-num">3</div>
        <div class="step-body">
          <div class="step-content">${escHtml(T('add_hint'))}</div>
          <button class="step-action" onclick="openAddFriend()">+ ${escHtml(T('add_friend'))}</button>
        </div>
      </div>
    </div>`;
  return;
}
```

**Step 3：在 `<script>` 块中添加 `copyContactId` 函数**

```javascript
function copyContactId(btn, id) {
  navigator.clipboard.writeText(id).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = escHtml(T('copied'));
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }).catch(() => {});
}
```

**Step 4：手动验证**

1. 用一个没有联系人的账号登录（或新注册）
2. 主页显示三步引导卡片，第一步显示自己的 `#contactId`
3. 点击联系号 chip → 显示"已复制 ✓"，1.5 秒后恢复
4. 点击步骤③的 `+` 按钮 → 打开添加好友抽屉
5. 切换界面语言（点顶栏头像 → 设置）→ 卡片文字立即变为对应语言
6. 添加好友后回到主页 → 卡片消失，显示联系人列表

**Step 5：提交**

```bash
git add public/home.html
git commit -m "feat: replace empty state with 3-step onboarding card"
```

---

### Task 4：推送并验证线上

**Step 1：推送**

```bash
git push origin main
```

**Step 2：等待 Render 部署完成后，用新账号走完整流程**

1. 打开 `/register.html` → 切换语言 → 注册
2. 进入主页 → 看到引导卡片 → 复制联系号 → 添加好友
3. 进入聊天 → 发消息 → 确认 AI 分析、翻译正常

---
