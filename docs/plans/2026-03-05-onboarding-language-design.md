# 设计文档：注册页语言切换 + 主页空状态引导

**日期**：2026-03-05
**状态**：已批准，待实施

---

## 背景

新用户首次打开 BridgeIt 时面临两个摩擦点：
1. 注册页面默认中文，非中文用户看不懂表单
2. 注册成功后主页空空如也，不知道下一步该怎么做

---

## 功能一：注册页语言切换条

### 位置
登录卡片（`.login-card`）内部最顶端，logo 上方。

### 样式
5 个等宽旗帜按钮横排，选中时紫色圆形背景高亮：
```
🇨🇳  🇺🇸  🇪🇸  🇷🇺  🇫🇷
```

### 交互
- 点击旗帜 → `localStorage.setItem('bridgeit_lang', code)` + `applyI18n()` → 页面文本立即切换
- 初始高亮根据 `getLang()` 确定（尊重已有 localStorage 设置）
- 注册成功后语言通过现有 `/auth/create` → `PATCH /auth/profile` 机制同步到服务端

### 新增 CSS
```css
.lang-strip { display: flex; justify-content: center; gap: 6px; margin-bottom: 20px; }
.lang-strip-btn {
  width: 36px; height: 36px; border-radius: 50%; border: 2px solid transparent;
  background: none; font-size: 1.2rem; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.lang-strip-btn.active { border-color: var(--purple); background: var(--purple-bg); }
```

---

## 功能二：主页空状态步骤卡片

### 触发条件
`GET /rooms` 返回空数组时，替换现有空状态 div。

### 卡片结构
```
欢迎使用 BridgeIt 👋

① 你的联系号   [#alice]  📋
   点击联系号可复制

② 把联系号发给想聊天的朋友

③ 点右下角 + 输入对方联系号
   立即建立对话   →  [直接触发添加好友抽屉]
```

### 交互细节
- 联系号区域（`#alice`）点击 → `navigator.clipboard.writeText(contactId)` → 短暂显示"已复制 ✓"（1.5s 后还原）
- 步骤③点击触发 `openAddFriend()`（与右下角 FAB 相同）
- 卡片文本全部走 i18n，随界面语言即时切换

### 新增 i18n Key

| key | 中文 | 英文 |
|---|---|---|
| `welcome_title` | 欢迎使用 BridgeIt 👋 | Welcome to BridgeIt 👋 |
| `your_contact_id` | 你的联系号 | Your Contact ID |
| `copied` | 已复制 ✓ | Copied ✓ |
| `share_hint` | 把联系号发给想聊天的朋友 | Share your ID with a friend |
| `add_hint` | 点 + 输入对方联系号，立即开始对话 | Tap + and enter their ID to start chatting |

（西班牙语 / 俄语 / 法语同步补全）

---

## 受影响文件

| 文件 | 改动 |
|---|---|
| `public/register.html` | 新增 `.lang-strip` 组件 + JS 切换逻辑 |
| `public/home.html` | 替换 `renderRooms()` 空状态分支 |
| `public/js/i18n.js` | 新增 5 个 key × 5 种语言 |

---

## 不在本次范围内
- 登录页不加语言切换（登录用户已有语言偏好）
- 不做可滑动 onboarding flow
- 不做消息通知、未读角标等其他优化
