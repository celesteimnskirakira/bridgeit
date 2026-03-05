# BridgeIt — Project Reference for Claude

## What This Is
Real-time two-person chat app with AI mediation. Each message triggers an AI analysis (via OpenRouter) that shows the **receiver** an empathy insight, actionable advice, and optional knowledge facts. Supports multi-language translation in message bubbles.

## Stack
- **Backend**: Node.js + Express + Socket.io
- **Database**: MongoDB Atlas (primary) with local JSON file fallback
- **Auth**: contactId + PIN (bcrypt hash), JWT (30-day tokens)
- **AI**: OpenRouter API (`openai/gpt-4o-mini` default), via `openai` npm package
- **Frontend**: Vanilla JS, single CSS file (`/css/mobile.css`)
- **Deploy**: Render (`render.yaml` in repo root)

## Key Files
```
bridgeit/
├── server.js              # All backend logic (auth, rooms, socket, AI)
├── render.yaml            # Render deployment config
├── package.json
├── public/
│   ├── css/mobile.css     # Shared CSS vars and base styles
│   ├── js/i18n.js         # i18n strings + helpers (T(), applyI18n(), getLang())
│   ├── index.html         # Redirects to /login.html
│   ├── login.html
│   ├── register.html
│   ├── home.html          # Room list + add-friend drawer + language settings
│   ├── chat.html          # Real-time chat, AI cards, translation drawer
│   ├── manifest.json
│   └── sw.js              # Service worker (PWA)
└── data/                  # Local file fallback (gitignored)
    ├── users.json
    ├── rooms.json
    └── bridgeit-data.json
```

## Environment Variables (set in Render)
| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | Crashes on startup if missing |
| `MONGODB_URI` | Yes (prod) | Falls back to local JSON files |
| `JWT_SECRET` | Recommended | Defaults to dev secret |
| `AI_MODEL` | No | Default: `openai/gpt-4o-mini` |
| `ROOM_PASSWORD` | No | Not currently used in UI |

## Data Models

### User (MongoDB `users` collection)
```json
{ "id": "string", "contactId": "string (lowercase, 3-20 alphanumeric)", "nickname": "string", "pinHash": "bcrypt hash", "language": "zh|en|es|ru|fr", "createdAt": "timestamp" }
```

### Room (MongoDB `rooms` collection)
```json
{ "id": "string", "participants": ["userId1", "userId2"], "translateTo": ["en", "zh"], "createdAt": "timestamp" }
```

### Message (MongoDB `messages` collection)
```json
{ "id": "number (autoincrement)", "roomId": "string", "conversationId": "string (=roomId)", "senderId": "string", "senderNickname": "string", "text": "string", "timestamp": "number", "analysis": { ...aiResult } }
```

## Auth Flow
- Register: `POST /auth/create` → `{ contactId, nickname, pin }` → returns JWT + user
- Login: `POST /auth/login` → `{ contactId, pin }` → returns JWT + user
- Availability check: `GET /auth/check/:contactId` → `{ available: bool }`
- Profile update: `PATCH /auth/profile` → `{ nickname?, language? }`

## Room / Friend Flow
- Add friend: `POST /rooms/add` → `{ contactId }` → creates room, returns `{ roomId, partner }`
- Room list: `GET /rooms` → array of rooms with partner info and last message
- Translation setting: `PATCH /rooms/:roomId/translate` → `{ translateTo: ["en"] }`

## Socket.io Events
| Event | Direction | Payload |
|---|---|---|
| `join-room` | client→server | `roomId`, cb receives `{ messages }` |
| `send-message` | client→server | `{ roomId, text }` |
| `new-message` | server→client | message object |
| `ai-thinking` | server→client | `{ roomId, thinking: bool }` |
| `ai-analysis` | server→client | `{ insight, advice, knowledgeBridge, translations, senderId, receiverId, messageId, roomId }` |
| `topic-break` | server→client | break message object |
| `new-topic-break` | client→server | `{ roomId }`, cb `{ ok }` |

## AI Analysis
- Triggered by every `send-message`
- Model: configured via `AI_MODEL` env var
- Context: messages since last topic-break, limited to 2000 chars
- Returns JSON: `{ insight, advice[2], knowledgeBridge: { topic, facts[2] } | null, translations: { lang: text } }`
- Saved to `message.analysis` in MongoDB
- `ai-analysis` socket event sent to all room participants
- **Frontend shows AI card only to the receiver** (`analysis.receiverId === myId`)

## i18n
- Languages: zh (default), en, es, ru, fr
- Stored in: `localStorage.bridgeit_lang` (persists across logout)
- Also synced to: `user.language` in MongoDB via `PATCH /auth/profile`
- Helper: `T('key')` returns translated string, `applyI18n()` updates DOM elements with `data-i18n` attribute
- Language is changed in home.html settings drawer

## Frontend Conventions
- All pages use `mobile.css` and `js/i18n.js`
- Auth token: `localStorage.bridgeit_token` (JWT Bearer)
- User info: `localStorage.bridgeit_user` (JSON: id, contactId, nickname, language)
- Language: `localStorage.bridgeit_lang`
- Current room: `localStorage.bridgeit_current_room`
- Partner name: `localStorage.bridgeit_partner_name`
- User ID is also parsed from JWT token as fallback: `atob(token.split('.')[1])`
- CSS variables defined in `mobile.css` `:root`

## Local Development
```bash
export OPENROUTER_API_KEY=sk-or-...
node server.js
# → http://localhost:3000
# Data saved to bridgeit/data/ (gitignored)
# MONGODB_URI not needed locally
```

## Known Patterns
- File storage (loadUsersFile, loadRoomsFile etc.) is fallback only — prod uses MongoDB
- All user/room DB operations are async (await everywhere)
- Socket.io middleware is async to support MongoDB user lookup
- `messageIdCounter` is an in-process integer, initialized from DB max on startup
- Translations in message bubbles come from `analysis.translations`, attached via `attachTranslations()` after `ai-analysis` event
- Historical message translations come from `msg.analysis?.translations` (loaded in `join-room`)
