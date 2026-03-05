# 设计文档：对方气泡颜色自定义 + 聊天设置抽屉整合

**日期**：2026-03-05
**状态**：已批准，待实施

---

## 背景

聊天页当前的 🌐 按钮只能管理翻译语言，颜色无法自定义。用户希望：
1. 能自定义"对方气泡"的颜色（我的气泡颜色保持紫色渐变不变）
2. 将翻译设置和颜色设置合并到一个统一的 ⚙️ 设置入口

---

## 功能设计

### 入口
聊天页 topbar 的 🌐 按钮改为 ⚙️，点击打开设置抽屉。

### 抽屉结构
```
⚙️ 设置

── 消息翻译 ──────────────────────
  [原有翻译语言设置，完整保留]

── 对方气泡颜色 ──────────────────
  [■ color picker]  #ffffff  [恢复默认]

                          [保存]
```

### 颜色选择器
- 原生 `<input type="color">` 控件
- 默认值：`#ffffff`（白色）
- 实时预览：`input` 事件触发 `document.documentElement.style.setProperty('--partner-bubble', val)`
- 关闭不保存时还原（读回 localStorage 值）

### 存储
- `localStorage.bridgeit_partner_color`
- 全局生效（不按房间区分）
- 页面加载时读取并应用 CSS 变量

### CSS 变量
在 `chat.html` `<style>` 块中：
```css
:root { --partner-bubble: #ffffff; }
.theirs .bubble { background: var(--partner-bubble); }
```

---

## 受影响文件

| 文件 | 改动 |
|---|---|
| `public/chat.html` | ⚙️ 按钮、设置抽屉 HTML/CSS/JS |
| `public/js/i18n.js` | 新增 `partner_bubble_color`、`reset_default` 两个 key × 5 种语言 |

---

## 不在本次范围内
- 自己气泡颜色自定义（保持紫色渐变）
- 按房间区分颜色
- 同步颜色到服务器
