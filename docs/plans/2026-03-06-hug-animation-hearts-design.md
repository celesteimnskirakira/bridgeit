# 设计文档：拥抱动画 + 爱心进度链 + 对方文字颜色

**日期**：2026-03-06
**状态**：已批准，待实施

---

## 功能一：拥抱动画（topic restart 触发）

### 触发时机
用户确认"确定开启新话题吗？"后，**立即播放动画**（与 socket 事件并行，不阻塞）。

### 动画规格
- **总时长**：1.2 秒，全程 CSS keyframe，结束后从 DOM 移除
- **浮层**：全屏 `position:fixed; z-index:999`，背景 `rgba(13,13,26,0.7)`，fadeIn 0.15s / fadeOut 0.2s
- **两个小人**：用 emoji `🫂`（拥抱表情）或两个圆形 blob（左紫右蓝），大小 56px
  - 左侧小人从 `translateX(-80px)` 滑入中央，颜色 `rgba(156,39,176,0.9)`（我方紫）
  - 右侧小人从 `translateX(+80px)` 滑入中央，颜色 `var(--partner-bubble)`（对方色）
  - 滑入 0.4s → 中央停留 0.3s（轻微 scale 1.1 模拟拥抱）→ 炸开
- **心形粒子**：拥抱时刻后，8 颗 `♥` 从中央向外 8 个方向飞出，同时 fade out，持续 0.5s
- **节奏**：0s 入场 → 0.4s 相遇 → 0.7s 拥抱峰值 → 0.7s 炸心 → 1.2s 浮层消失

### 实现方式
纯 CSS keyframes + 一个 `showHugAnimation()` JS 函数，动态创建 DOM、添加到 body、动画结束后 remove。无外部依赖。

---

## 功能二：顶栏爱心进度链

### 位置
替换 `.topbar-dots` 内的 `.tline-offline` / `.tline-online`（连接线区域），改为 5 颗心形 + 等级徽章。

### 数据
- `topicCount`（整数，累计话题数）
  - **初始加载**：`GET /rooms` 响应中每个 room 对象新增 `topicCount` 字段
  - **实时更新**：`topic-summary` socket 事件 payload 新增 `topicCount`
- 计算：
  ```
  level      = Math.floor(topicCount / 5) + 1
  heartsLit  = topicCount % 5
  ```

### 视觉规格
```
[♥ ♥ ♥ ♡ ♡]  ②
 ← 5颗心 →  等级徽章
```
- 心形字符：实心 `♥` / 空心 `♡`，大小 `0.85rem`，间距 `2px`
- 颜色随等级：
  | 等级 | 颜色 |
  |---|---|
  | Lv 1 | `#ff9eb5`（粉） |
  | Lv 2 | `#ff4d6d`（红） |
  | Lv 3 | `#FFD54F`（金） |
  | Lv 4 | `#ce93d8`（紫） |
  | Lv 5+ | `linear-gradient` 彩虹（CSS background-clip:text） |
- 等级徽章：`②` 样式，`font-size: 0.62rem`，颜色与心形同色

### 升级动画
`heartsLit` 从 0 变成 0（即 topicCount 是 5 的倍数）时触发：
1. 5 颗心全亮 → `animation: heartPulse 0.4s` 闪烁两次
2. 0.4s 后重置为新等级颜色 + 0 颗实心

### HTML 结构（替换现有 tline）
```html
<div class="heart-chain" id="heart-chain">
  <span class="heart-item">♡</span>
  <span class="heart-item">♡</span>
  <span class="heart-item">♡</span>
  <span class="heart-item">♡</span>
  <span class="heart-item">♡</span>
  <span class="heart-level" id="heart-level">①</span>
</div>
```

### JS 函数
```javascript
function updateHeartChain(topicCount) {
  const level = Math.floor(topicCount / 5) + 1;
  const lit   = topicCount % 5;
  // 更新心形、颜色、等级
}
```
- 页面加载时从 room 数据调用一次
- `topic-summary` 事件中更新，若 level 升级则触发 heartPulse 动画

---

## 功能三：对方文字颜色自定义

### CSS 变量
```css
:root { --partner-text: #e8e8e8; }
.theirs .bubble { color: var(--partner-text); }  /* 替换硬编码 rgba(255,255,255,0.9) */
```

### 设置抽屉 HTML（紧接气泡颜色下方）
```html
<div class="tl-section-label" data-i18n="partner_text_color">对方文字颜色</div>
<div class="color-row">
  <input type="color" id="partner-text-input" value="#e8e8e8"
    oninput="document.documentElement.style.setProperty('--partner-text', this.value)">
  <button class="reset-color-btn" onclick="resetTextColor()" data-i18n="reset_default">恢复默认</button>
</div>
```

### JS
```javascript
function loadPartnerTextColor() {
  const c = localStorage.getItem('bridgeit_partner_text_color') || '#e8e8e8';
  document.documentElement.style.setProperty('--partner-text', c);
}

function resetTextColor() {
  document.getElementById('partner-text-input').value = '#e8e8e8';
  document.documentElement.style.setProperty('--partner-text', '#e8e8e8');
}
// saveSettings() 里同步保存 bridgeit_partner_text_color
// openSettingsDrawer() 里同步读取并设置 input value
```

### i18n 新增键（5 种语言）
```
partner_text_color: '对方文字颜色' / 'Partner Text Color' / 'Color de texto del otro' / 'Цвет текста собеседника' / 'Couleur du texte du partenaire'
```

---

## 受影响文件

| 文件 | 改动 |
|---|---|
| `server.js` | `GET /rooms` + `topic-summary` emit 加 `topicCount` 字段 |
| `public/chat.html` | 拥抱动画 CSS+JS；heart-chain HTML+JS；对方文字颜色 CSS+HTML+JS |
| `public/js/i18n.js` | 新增 `partner_text_color` 键（5 语言） |

---

## 不在本次范围内
- 话题历史页（journal.html）显示等级
- 好友列表（home.html）显示关系等级
- 拥抱动画的声音效果
