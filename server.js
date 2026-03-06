const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const OpenAI = require('openai');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bridgeit-dev-secret-change-in-prod';
const SALT_ROUNDS = 10;

if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is not set. Export it before starting.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const AI_MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─── Database / Persistence ─────────────────────────────────
let useDB = false;
let messagesCollection = null;
let conversationsCollection = null;
let usersCollection = null;
let roomsCollection = null;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bridgeit-data.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

let conversations = [];
let fileMessages = [];
let messageIdCounter = 0;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── File-based User/Room Storage (fallback) ──────────────────
function loadUsersFile() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) { console.error('loadUsersFile error:', e.message); }
  return [];
}

function saveUsersFile(users) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) { console.error('saveUsersFile error:', e.message); }
}

function loadRoomsFile() {
  try {
    if (fs.existsSync(ROOMS_FILE)) return JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf-8'));
  } catch (e) { console.error('loadRoomsFile error:', e.message); }
  return [];
}

function saveRoomsFile(rooms) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));
  } catch (e) { console.error('saveRoomsFile error:', e.message); }
}

// ─── User Operations (async, DB or file) ──────────────────────
async function findUserById(id) {
  if (useDB) {
    const doc = await usersCollection.findOne({ id });
    if (!doc) return null;
    const { _id, ...user } = doc;
    return user;
  }
  return loadUsersFile().find(u => u.id === id) || null;
}

async function findUserByContactId(contactId) {
  if (useDB) {
    const doc = await usersCollection.findOne({ contactId: contactId.toLowerCase() });
    if (!doc) return null;
    const { _id, ...user } = doc;
    return user;
  }
  return loadUsersFile().find(u => u.contactId === contactId.toLowerCase()) || null;
}

async function createUser(user) {
  if (useDB) {
    await usersCollection.insertOne({ ...user });
  } else {
    const users = loadUsersFile();
    users.push(user);
    saveUsersFile(users);
  }
}

async function updateUser(id, updates) {
  if (useDB) {
    await usersCollection.updateOne({ id }, { $set: updates });
  } else {
    const users = loadUsersFile();
    const user = users.find(u => u.id === id);
    if (user) Object.assign(user, updates);
    saveUsersFile(users);
  }
}

// ─── Room Operations (async, DB or file) ──────────────────────
async function getRoomsForUser(userId) {
  if (useDB) {
    const docs = await roomsCollection.find({ participants: userId }).toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  return loadRoomsFile().filter(r => r.participants.includes(userId));
}

async function getRoomById(roomId) {
  if (useDB) {
    const doc = await roomsCollection.findOne({ id: roomId });
    if (!doc) return null;
    const { _id, ...room } = doc;
    return room;
  }
  return loadRoomsFile().find(r => r.id === roomId) || null;
}

async function findRoomBetweenUsers(userId1, userId2) {
  if (useDB) {
    const doc = await roomsCollection.findOne({ participants: { $all: [userId1, userId2] } });
    if (!doc) return null;
    const { _id, ...room } = doc;
    return room;
  }
  return loadRoomsFile().find(r => r.participants.includes(userId1) && r.participants.includes(userId2)) || null;
}

async function createRoom(room) {
  if (useDB) {
    await roomsCollection.insertOne({ ...room });
  } else {
    const rooms = loadRoomsFile();
    rooms.push(room);
    saveRoomsFile(rooms);
  }
}

// translateTo 以 { userId: string[] } 格式按用户存储
async function updateRoomTranslate(roomId, userId, langs) {
  if (useDB) {
    await roomsCollection.updateOne({ id: roomId }, { $set: { [`translateTo.${userId}`]: langs } });
  } else {
    const rooms = loadRoomsFile();
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      if (!room.translateTo || Array.isArray(room.translateTo)) room.translateTo = {};
      room.translateTo[userId] = langs;
    }
    saveRoomsFile(rooms);
  }
}

async function updateRoomMemory(roomId, topicSummary) {
  const entry = { timestamp: Date.now(), summary: topicSummary };
  if (useDB) {
    // 追加到 topicHistory，保留最近 20 条，同时累加 topicCount
    await roomsCollection.updateOne(
      { id: roomId },
      {
        $push: { topicHistory: { $each: [entry], $slice: -20 } },
        $inc: { topicCount: 1 },
      }
    );
    // 每 5 条更新一次 relationshipProfile
    const room = await getRoomById(roomId);
    if (room && room.topicCount % 5 === 0) {
      await updateRelationshipProfile(roomId, room);
    }
  } else {
    const rooms = loadRoomsFile();
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      if (!Array.isArray(room.topicHistory)) room.topicHistory = [];
      room.topicHistory.push(entry);
      if (room.topicHistory.length > 20) room.topicHistory = room.topicHistory.slice(-20);
      room.topicCount = (room.topicCount || 0) + 1;
      saveRoomsFile(rooms);
      if (room.topicCount % 5 === 0) {
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
  // 找最近一个 topic-break 之后的消息（即当前话题的消息）
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
  const names = participants.map(u => u?.nickname || u?.id || 'User').join(' & ');

  try {
    const resp = await openrouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: `You are BridgeIt. Summarize what ${names} mutually understood in this conversation topic in 1-2 warm sentences. Start with "在这段对话里" if Chinese is dominant, or "In this conversation" if English. Focus on what they understood about each other, not what happened.` },
        { role: 'user', content: `Conversation:\n${convo.join('\n')}\n\nWrite the mutual understanding summary.` },
      ],
      temperature: 0.6,
    });
    return resp.choices[0].message.content.trim();
  } catch (e) { console.error('getTopicSummary AI error:', e.message); return null; }
}

// 获取某用户在某房间的 translateTo 配置（兼容旧的数组格式）
function getUserTranslateTo(room, userId) {
  if (!room.translateTo) return [];
  if (Array.isArray(room.translateTo)) return room.translateTo; // 旧格式兼容
  return room.translateTo[userId] || [];
}

// 所有参与者 translateTo 的并集（用于给 AI 生成翻译）
function getAllTranslateTo(room) {
  if (!room.translateTo) return [];
  if (Array.isArray(room.translateTo)) return room.translateTo;
  const all = [];
  for (const langs of Object.values(room.translateTo)) {
    for (const l of langs) { if (!all.includes(l)) all.push(l); }
  }
  return all;
}

async function initDB() {
  if (!MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('bridgeit');
    messagesCollection = db.collection('messages');
    conversationsCollection = db.collection('conversations');
    usersCollection = db.collection('users');
    roomsCollection = db.collection('rooms');
    await messagesCollection.createIndex({ id: 1 }, { unique: true });
    await messagesCollection.createIndex({ conversationId: 1 });
    await conversationsCollection.createIndex({ id: 1 }, { unique: true });
    await usersCollection.createIndex({ id: 1 }, { unique: true });
    await usersCollection.createIndex({ contactId: 1 }, { unique: true });
    await roomsCollection.createIndex({ id: 1 }, { unique: true });
    await roomsCollection.createIndex({ participants: 1 });
    useDB = true;
    console.log('Connected to MongoDB Atlas');
  } catch (err) {
    console.error('MongoDB connection failed, falling back to file storage:', err.message);
  }
}

// ─── File Storage (messages/conversations) ────────────────────
function loadFileData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
    const OLD_FILE = path.join(DATA_DIR, 'chat-history.json');
    if (fs.existsSync(OLD_FILE)) {
      const oldMsgs = JSON.parse(fs.readFileSync(OLD_FILE, 'utf-8'));
      if (oldMsgs.length > 0) {
        const conv = {
          id: generateId(),
          title: (oldMsgs[0].text || 'Chat').slice(0, 30),
          createdAt: oldMsgs[0].timestamp || Date.now(),
          lastMessageAt: oldMsgs[oldMsgs.length - 1].timestamp || Date.now(),
        };
        oldMsgs.forEach((m) => (m.conversationId = conv.id));
        return { conversations: [conv], messages: oldMsgs };
      }
    }
  } catch (e) {
    console.error('Failed to load data:', e.message);
  }
  return { conversations: [], messages: [] };
}

function saveFileData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ conversations, messages: fileMessages }, null, 2)
    );
  } catch (e) {
    console.error('Failed to save data:', e.message);
  }
}

// ─── Migration (DB mode) ────────────────────────────────────
async function migrateOldData() {
  if (!useDB) return;
  const orphans = await messagesCollection
    .find({ conversationId: { $exists: false } })
    .sort({ id: 1 })
    .toArray();
  if (orphans.length === 0) return;

  const conv = {
    id: generateId(),
    title: (orphans[0].text || 'Chat').slice(0, 30),
    createdAt: orphans[0].timestamp || Date.now(),
    lastMessageAt: orphans[orphans.length - 1].timestamp || Date.now(),
  };
  await conversationsCollection.insertOne({ ...conv });
  await messagesCollection.updateMany(
    { conversationId: { $exists: false } },
    { $set: { conversationId: conv.id } }
  );
  console.log(`Migrated ${orphans.length} messages to conversation "${conv.title}"`);
}

// ─── Conversation Operations ─────────────────────────────────
async function loadConversations() {
  if (useDB) {
    const docs = await conversationsCollection
      .find({})
      .sort({ lastMessageAt: -1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  const data = loadFileData();
  fileMessages = data.messages || [];
  return (data.conversations || []).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

async function createConversation(title) {
  const conv = {
    id: generateId(),
    title: title || 'New Chat',
    createdAt: Date.now(),
    lastMessageAt: Date.now(),
  };
  conversations.unshift(conv);
  if (useDB) {
    await conversationsCollection.insertOne({ ...conv });
  } else {
    saveFileData();
  }
  return conv;
}

async function deleteConversation(convId) {
  conversations = conversations.filter((c) => c.id !== convId);
  if (useDB) {
    await conversationsCollection.deleteOne({ id: convId });
    await messagesCollection.deleteMany({ conversationId: convId });
  } else {
    fileMessages = fileMessages.filter((m) => m.conversationId !== convId);
    saveFileData();
  }
}

// ─── Message Operations ──────────────────────────────────────
async function loadMessages(roomId) {
  if (useDB) {
    const docs = await messagesCollection
      .find({ $or: [{ roomId }, { conversationId: roomId }] })
      .sort({ id: 1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  return fileMessages.filter((m) => m.roomId === roomId || m.conversationId === roomId);
}

async function saveMessage(message) {
  const convIdx = conversations.findIndex((c) => c.id === message.conversationId);
  if (convIdx >= 0) {
    conversations[convIdx].lastMessageAt = message.timestamp;
    const [conv] = conversations.splice(convIdx, 1);
    conversations.unshift(conv);
  }

  if (useDB) {
    try {
      await messagesCollection.insertOne({ ...message });
      await conversationsCollection.updateOne(
        { id: message.conversationId },
        { $set: { lastMessageAt: message.timestamp } }
      );
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  } else {
    fileMessages.push(message);
    saveFileData();
  }
}

async function saveAnalysis(messageId, analysis) {
  if (useDB) {
    try {
      await messagesCollection.updateOne({ id: messageId }, { $set: { analysis } });
    } catch (e) {
      console.error('DB update error:', e.message);
    }
  } else {
    const msg = fileMessages.find((m) => m.id === messageId);
    if (msg) msg.analysis = analysis;
    saveFileData();
  }
}

async function autoTitleConversation(convId, text) {
  const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
  const conv = conversations.find((c) => c.id === convId);
  if (conv && conv.title === 'New Chat') {
    conv.title = title;
    if (useDB) {
      await conversationsCollection.updateOne({ id: convId }, { $set: { title } });
    } else {
      saveFileData();
    }
    return title;
  }
  return null;
}

// ─── AI Prompt ───────────────────────────────────────────────
function buildSystemPrompt(senderNickname, receiverNickname, translateTo, memory = null, usedTopics = []) {
  const langNames = { zh: 'Chinese', en: 'English', es: 'Spanish', ru: 'Russian', fr: 'French' };
  const translationFields = translateTo.map(lang =>
    `    "${lang}": "Natural ${langNames[lang] || lang} translation of the latest message"`
  ).join(',\n');

  return `You are BridgeIt, an AI relationship mediator helping two people understand each other better.
The sender of the latest message is: ${senderNickname}
The receiver of the latest message is: ${receiverNickname}

Your job: decode the emotions beneath words, restore charitable intent, bridge the communication gap.
Never judge who is right or wrong. Focus on emotional understanding.

Analyze the latest message in the context of the recent conversation. Return ONLY valid JSON with NO markdown fences:

{
  "insight": "1 sentence in the receiver's likely language. Tell ${receiverNickname} what ${senderNickname} is really feeling and needing right now.",
  "advice": ["1. One actionable sentence for ${receiverNickname}", "2. One actionable sentence for ${receiverNickname}"],
  "knowledgeBridge": null,
  "translations": {
${translationFields}
  }
}

knowledgeBridge: Include it for any substantive message. Set to null ONLY for pure small talk ("hi", "ok", "on my way").
When included:
{
  "topic": "Exact narrow subject (e.g. 'Cortisol and Sleep Disruption', NOT 'Sleep Health')",
  "facts": ["1. Fact with specific numbers and named source", "2. Fact with specific numbers and named source"]
}

Rules:
- insight: exactly 1 sentence, warm and specific to this message
- advice: exactly 2 actionable sentences for the receiver
- translations: only include the languages specified (omit if translateTo is empty)
- knowledgeBridge facts: exactly 2, narrowly targeted, each with data + named source
- knowledgeBridge topic: must be NEW — do NOT repeat or paraphrase any topic already used in this conversation${usedTopics.length > 0 ? ': ' + usedTopics.join(', ') : ''}
- Never take sides. Focus on the emotional gap.
- Respond in the language the receiver is most likely comfortable with for insight/advice.${memory ? `

【Relationship Context】
${memory}` : ''}`;
}

// ─── Static Files ────────────────────────────────────────────
app.use(express.json());
app.use(express.static('public'));

// ─── Auth Routes ─────────────────────────────────────────────
app.get('/auth/check/:contactId', async (req, res) => {
  const exists = !!(await findUserByContactId(req.params.contactId));
  res.json({ available: !exists });
});

app.post('/auth/create', async (req, res) => {
  const { contactId, nickname, pin } = req.body;
  if (!contactId || !nickname || !pin) {
    return res.status(400).json({ error: 'contactId, nickname, pin required' });
  }
  if (!/^[a-zA-Z0-9]{3,20}$/.test(contactId)) {
    return res.status(400).json({ error: '联系号只能包含字母和数字，长度3-20位' });
  }
  if (await findUserByContactId(contactId)) {
    return res.status(409).json({ error: '联系号已被使用' });
  }
  const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
  const user = { id: generateId(), contactId: contactId.toLowerCase(), nickname, pinHash, language: 'zh', createdAt: Date.now() };
  await createUser(user);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, contactId: user.contactId, nickname: user.nickname, language: user.language } });
});

app.post('/auth/login', async (req, res) => {
  const { contactId, pin } = req.body;
  if (!contactId || !pin) return res.status(400).json({ error: 'contactId and pin required' });
  const user = await findUserByContactId(contactId);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(pin, user.pinHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, contactId: user.contactId, nickname: user.nickname, language: user.language } });
});

app.patch('/auth/profile', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    const { userId } = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    const { nickname, language } = req.body;
    const user = await findUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const updates = {};
    if (nickname) updates.nickname = nickname;
    if (language) updates.language = language;
    await updateUser(userId, updates);
    res.json({ id: userId, contactId: user.contactId, nickname: updates.nickname || user.nickname, language: updates.language || user.language });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ─── Room Routes ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    const { userId } = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    req.userId = userId;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// 获取用户的房间列表（联系人列表）
app.get('/rooms', authMiddleware, async (req, res) => {
  const rooms = await getRoomsForUser(req.userId);
  const result = await Promise.all(rooms.map(async (room) => {
    const partnerId = room.participants.find(id => id !== req.userId);
    const partner = await findUserById(partnerId);
    const msgs = await loadMessages(room.id);
    const lastMsg = msgs.filter(m => m.type !== 'topic-break').slice(-1)[0];
    return {
      id: room.id,
      partner: partner ? { id: partner.id, nickname: partner.nickname } : null,
      translateTo: getUserTranslateTo(room, req.userId),
      lastMessage: lastMsg ? { text: lastMsg.text, timestamp: lastMsg.timestamp } : null,
      topicCount: room.topicCount || 0,
    };
  }));
  result.sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
  res.json(result);
});

// 添加好友（直接通过联系号建立房间）
app.post('/rooms/add', authMiddleware, async (req, res) => {
  const { contactId } = req.body;
  if (!contactId) return res.status(400).json({ error: 'contactId required' });
  const partner = await findUserByContactId(contactId);
  if (!partner) return res.status(404).json({ error: '用户不存在' });
  if (partner.id === req.userId) return res.status(400).json({ error: '不能添加自己' });
  const existing = await findRoomBetweenUsers(req.userId, partner.id);
  if (existing) return res.json({ roomId: existing.id, partner: { id: partner.id, nickname: partner.nickname }, alreadyExists: true });
  const room = { id: generateId(), participants: [req.userId, partner.id], translateTo: [], createdAt: Date.now() };
  await createRoom(room);
  res.json({ roomId: room.id, partner: { id: partner.id, nickname: partner.nickname } });
});

// 更新当前用户在该房间的翻译偏好
app.patch('/rooms/:roomId/translate', authMiddleware, async (req, res) => {
  const { translateTo } = req.body;
  const room = await getRoomById(req.params.roomId);
  if (!room || !room.participants.includes(req.userId)) return res.status(403).json({ error: 'Forbidden' });
  await updateRoomTranslate(req.params.roomId, req.userId, translateTo || []);
  res.json({ ok: true });
});

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

// ─── Socket.io Auth Middleware ────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No auth token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserById(payload.userId);
    if (!user) return next(new Error('User not found'));
    socket.userId = user.id;
    socket.userNickname = user.nickname;
    next();
  } catch (e) {
    next(new Error('Invalid token'));
  }
});

// ─── Socket.io ───────────────────────────────────────────────
io.on('connection', async (socket) => {
  console.log('Connected:', socket.id, 'user:', socket.userNickname);

  socket.on('join-room', async (roomId, cb) => {
    const room = await getRoomById(roomId);
    if (!room || !room.participants.includes(socket.userId)) {
      return cb?.({ error: 'Forbidden' });
    }
    socket.join(roomId);
    const messages = await loadMessages(roomId);
    cb?.({ messages });
  });

  socket.on('send-message', async ({ roomId, text }) => {
    const room = await getRoomById(roomId);
    if (!room || !room.participants.includes(socket.userId)) return;

    const message = {
      id: ++messageIdCounter,
      roomId,
      senderId: socket.userId,
      senderNickname: socket.userNickname,
      text,
      timestamp: Date.now(),
    };
    await saveMessage({ ...message, conversationId: roomId });
    io.to(roomId).emit('new-message', message);

    // AI Analysis
    io.to(roomId).emit('ai-thinking', { roomId, thinking: true });
    try {
      const analysis = await getAIAnalysis(message, room);
      await saveAnalysis(message.id, analysis);
      io.to(roomId).emit('ai-analysis', analysis);
    } catch (err) {
      console.error('AI error:', err.message);
      io.to(roomId).emit('ai-error', { roomId, error: 'AI analysis temporarily unavailable' });
    }
    io.to(roomId).emit('ai-thinking', { roomId, thinking: false });
  });

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
      await updateRoomMemory(roomId, topicSummary);
      const updatedRoom = await getRoomById(roomId);
      io.to(roomId).emit('topic-summary', {
        roomId,
        summary: topicSummary,
        timestamp: breakMsg.timestamp,
        topicCount: updatedRoom?.topicCount || 0,
      });
    }

    io.to(roomId).emit('topic-break', breakMsg);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
  });
});

async function getAIAnalysis(latestMessage, room) {
  const allMessages = await loadMessages(latestMessage.roomId || latestMessage.conversationId);

  // 找到最近一个 topic-break 之后的消息
  let startIdx = 0;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i].type === 'topic-break') { startIdx = i + 1; break; }
  }
  const contextMessages = allMessages.slice(startIdx).filter(m => m.type !== 'topic-break');

  // Collect KB topics already used in this topic to avoid repetition
  const usedKBTopics = contextMessages
    .map(m => m.analysis?.knowledgeBridge?.topic)
    .filter(Boolean);

  // 按字数限制到最近 2000 字
  let charCount = 0;
  let windowStart = contextMessages.length - 1;
  for (let i = contextMessages.length - 1; i >= 0; i--) {
    charCount += (contextMessages[i].text || '').length;
    windowStart = i;
    if (charCount >= 2000) break;
  }
  const windowMessages = contextMessages.slice(windowStart);

  const senderId = latestMessage.senderId || latestMessage.user;
  const receiverId = room.participants.find(id => id !== senderId);
  const sender = await findUserById(senderId);
  const receiver = await findUserById(receiverId);
  const senderName = sender?.nickname || senderId;
  const receiverName = receiver?.nickname || receiverId;

  const convo = await Promise.all(windowMessages.map(async m => {
    const u = await findUserById(m.senderId || m.user);
    const nick = u?.nickname || m.user || m.senderId;
    return `[${nick}]: ${m.text}`;
  }));

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
  const systemPrompt = buildSystemPrompt(senderName, receiverName, translateTo, memory, usedKBTopics);

  const resp = await openrouter.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Recent conversation:\n${convo.join('\n')}\n\nAnalyze the latest message from ${senderName}: "${latestMessage.text}"` },
    ],
    temperature: 0.7,
  });

  const analysis = parseJSON(resp.choices[0].message.content);
  if (Array.isArray(analysis.knowledgeBridge?.facts)) {
    analysis.knowledgeBridge.facts = analysis.knowledgeBridge.facts.slice(0, 2);
  }
  if (Array.isArray(analysis.advice)) {
    analysis.advice = analysis.advice.slice(0, 2);
  }

  return { ...analysis, senderId, receiverId, messageId: latestMessage.id, roomId: room.id };
}

function parseJSON(text) {
  let s = text.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1].trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    const jsonMatch = s.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error(`Failed to parse AI response as JSON: ${s.slice(0, 200)}`);
  }
}

// ─── Start ───────────────────────────────────────────────────
async function main() {
  await initDB();
  await migrateOldData();
  conversations = await loadConversations();

  if (useDB) {
    const maxMsg = await messagesCollection.find({}).sort({ id: -1 }).limit(1).toArray();
    messageIdCounter = maxMsg.length > 0 ? maxMsg[0].id : 0;
  } else {
    messageIdCounter =
      fileMessages.length > 0 ? Math.max(...fileMessages.map((m) => m.id || 0)) : 0;
  }

  server.listen(PORT, () => {
    console.log(`BridgeIt running at http://localhost:${PORT}`);
    if (ROOM_PASSWORD) console.log('Room is password-protected');
    console.log(`Model: ${AI_MODEL}`);
    console.log(`Storage: ${useDB ? 'MongoDB Atlas' : 'Local file'}`);
    console.log(`Conversations: ${conversations.length}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
