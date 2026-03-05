# 设计文档：BridgeIt 全面 UI 重设计

**日期**：2026-03-05
**状态**：已批准，待实施
**原型文件**：`docs/prototypes/proto-final.html`

---

## 设计目标

将现有朴素的白底聊天界面升级为视觉创新、有记忆点的深色玻璃态设计，以"Bridge Lane 双轨布局"为核心，让 BridgeIt 的"两人一桥"概念在视觉上直接呈现。

---

## 设计语言系统

### 背景
- 深色底：`#0d0d1a`
- 紫色光晕球：`rgba(123,31,162,0.42)`，左上角，CSS animation 缓慢浮动
- 黄色光晕球：`rgba(255,179,0,0.32)`，右下角，独立浮动频率
- 动画：`blobFloat` 每 16-20s 一次，translate + scale 轻微变化

### 玻璃态公式（统一所有表面）
```css
background: rgba(13,13,26,0.6);
backdrop-filter: blur(32px) saturate(180%);
-webkit-backdrop-filter: blur(32px) saturate(180%);
border: 1px solid rgba(255,255,255,0.07~0.15);
```

### 双色强调系统
| 角色 | 颜色 |
|---|---|
| 自己气泡 / 发送按钮 / FAB | 紫色渐变 `#9C27B0 → #5C6BC0` |
| AI Bridge 卡片 / 未读角标 | 金色 `#FFB300 → #FFA000` |
| 对方气泡 | 白色玻璃 `rgba(255,255,255,0.09)` |
| 中轴线 | 紫→金渐变 |

### 文字
- 主文：`white` / `rgba(255,255,255,0.85~0.9)`
- 次级：`rgba(255,255,255,0.4~0.5)`
- 标签/时间：`rgba(255,255,255,0.22~0.35)`

---

## 聊天页（chat.html）

### Bridge Lane 双轨布局
- 自己消息：左侧，`margin-right: calc(50% + 10px)`，最大宽度 `calc(48% - 10px)`，右对齐文字
- 对方消息：右侧，`margin-left: calc(50% + 10px)`，最大宽度同上
- 消息气泡圆角：`16px 16px 3px 16px`（自己）/ `16px 16px 16px 3px`（对方）

### 中轴线（Spine）
```css
position: absolute; left: 50%; top: 0; bottom: 0; width: 1px;
background: linear-gradient(180deg,
  transparent 0%,
  rgba(156,39,176,0.18) 15%,
  rgba(180,80,180,0.15) 50%,
  rgba(255,179,0,0.15) 80%,
  transparent 100%
);
```

### Topbar
- 玻璃态，高度 64px
- 中央：对方名字（`font-weight:700, 1.05rem`）+ 双色连接点
- **在线状态**：金色光点从左向右流动穿过（`tflow` animation，3个点，延迟 0.5s 间隔）
- **离线状态**：细暗线 `rgba(255,255,255,0.12)`，双侧点降透明度

### AI Bridge 卡片（金色）
```css
background: rgba(255,179,0,0.07);
border: 1px solid rgba(255,179,0,0.22);
border-radius: 18px;
box-shadow: 0 4px 28px rgba(255,179,0,0.08);
```
- 金色光晕小圆球图标（`#FFD54F → #FFA000` 渐变）
- 标签文字：`#FFD54F`，全大写，0.63rem

### 自己气泡（紫色）
```css
background: linear-gradient(140deg, rgba(156,39,176,0.78), rgba(92,107,192,0.72));
border: 1px solid rgba(179,136,255,0.32);
box-shadow: 0 4px 20px rgba(123,31,162,0.3);
```

### 对方气泡（玻璃白）
```css
background: rgba(255,255,255,0.09);
border: 1px solid rgba(255,255,255,0.14);
box-shadow: 0 4px 20px rgba(0,0,0,0.18);
```

### 输入栏
- 玻璃态底色，高度 68px，底部 padding 18px（safe area）
- 输入框：`rgba(255,255,255,0.08)` 背景，pill 形
- 发送按钮：紫色渐变圆形，`:active { transform: scale(0.93) }`

---

## 主页（home.html）

### Topbar
- 左：`BridgeIt` 大字，`It` 部分做紫→金渐变文字
- 右：自己联系号圆形头像（玻璃底）

### Bento 连接卡网格
- 2列网格，`gap: 10px`，`padding: 18px 14px`
- 每张卡：玻璃态，`border-radius: 20px`，`:active { transform: scale(0.97) }`

**卡片内容结构（从上到下）：**
1. 连接行：自己头像（紫色渐变底）+ 连接线 + 对方头像（玻璃底）
   - 在线：`linear-gradient(90deg, rgba(179,136,255,0.6), rgba(255,213,79,0.5))`
   - 离线：`rgba(255,255,255,0.1)`
2. 对方名字（`0.88rem, font-weight:700`）+ 消息预览（2行截断）
3. 时间 + 未读角标（金色渐变圆形）

### FAB
- 紫色渐变圆形，52px
- `:active { transform: scale(0.93) rotate(45deg) }`（+号变×）

---

## 登录 / 注册页（login.html / register.html）

### 背景
与聊天页完全相同：`#0d0d1a` + 紫色 + 黄色浮动光晕球

### 顶部 Logo
```css
font-size: 2rem; font-weight: 900; letter-spacing: -1px;
background: linear-gradient(135deg, #ce93d8 0%, #FFD54F 100%);
-webkit-background-clip: text; -webkit-text-fill-color: transparent;
```
下方 slogan：`rgba(255,255,255,0.3)`，小字

### 登录卡片（玻璃）
```css
background: rgba(255,255,255,0.07);
backdrop-filter: blur(40px) saturate(180%);
border: 1px solid rgba(255,255,255,0.12);
border-radius: 28px;
box-shadow: 0 20px 60px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
```

### 输入框
```css
background: rgba(255,255,255,0.08);
border: 1px solid rgba(255,255,255,0.1);
border-radius: 14px; color: rgba(255,255,255,0.85);
```
Focus：`border-color: rgba(179,136,255,0.5); background: rgba(255,255,255,0.1)`

### 登录按钮
全宽，紫色渐变，`border-radius: 14px`，`:active { opacity: 0.85 }`

### 语言切换条（register.html）
圆形旗帜按钮，激活态：`border-color: rgba(179,136,255,0.6); background: rgba(156,39,176,0.15)`

---

## 受影响文件

| 文件 | 改动类型 |
|---|---|
| `public/css/mobile.css` | CSS 变量升级：背景色、blob 动画、玻璃态基础样式 |
| `public/chat.html` | Bridge Lane 布局、topbar、气泡、AI 卡片、输入栏、在线状态 |
| `public/home.html` | Bento 连接卡、topbar、FAB |
| `public/login.html` | 深色背景、玻璃卡片、输入框、按钮 |
| `public/register.html` | 同 login，保留语言切换条升级样式 |
| `public/js/i18n.js` | 无需新增 key（颜色/布局改动不涉及文字） |

---

## 不在本次范围内
- Socket.io / 服务端逻辑（零后端改动）
- 对方气泡颜色自定义（已有独立 issue #bubble-color）
- 深色/浅色模式切换
- 动画音效
