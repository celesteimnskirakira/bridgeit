const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const OpenAI = require('openai');

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

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bridgeit-data.json');

let conversations = [];
let fileMessages = [];
let messageIdCounter = 0;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    await messagesCollection.createIndex({ id: 1 }, { unique: true });
    await messagesCollection.createIndex({ conversationId: 1 });
    await conversationsCollection.createIndex({ id: 1 }, { unique: true });
    useDB = true;
    console.log('Connected to MongoDB Atlas');
  } catch (err) {
    console.error('MongoDB connection failed, falling back to file storage:', err.message);
  }
}

// ─── File Storage ────────────────────────────────────────────
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
async function loadMessages(convId) {
  if (useDB) {
    const docs = await messagesCollection
      .find({ conversationId: convId })
      .sort({ id: 1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  return fileMessages.filter((m) => m.conversationId === convId);
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
const SYSTEM_PROMPT = `You are BridgeIt, an AI relationship mediator for a couple: Celeste and Jack.
Celeste communicates in Russian, Chinese, and English.
Jack communicates in Chinese, English, and Russian.

Your job: decode the emotions beneath words, restore charitable intent, and bridge the communication gap.

Analyze the latest message in the context of the recent conversation. Return ONLY valid JSON with NO markdown fences:

{
  "insightForJack": "1 sentence in English. Tell Jack what Celeste is feeling and what she needs right now.",
  "insightForCeleste": "1 sentence in English. Tell Celeste what Jack is feeling and what he needs right now.",
  "adviceToJack": ["1. One actionable sentence for Jack", "2. One actionable sentence for Jack"],
  "adviceToCeleste": ["1. One actionable sentence for Celeste", "2. One actionable sentence for Celeste"],
  "knowledgeBridge": null,
  "translations": {
    "zh": "Natural Chinese translation of the latest message",
    "en": "Natural English translation of the latest message",
    "ru": "Natural Russian translation of the latest message"
  }
}

knowledgeBridge: ALWAYS provide it by DEFAULT. The ONLY exception to set it to null is pure small talk with zero topical content (e.g. "hi", "good morning", "ok", "on my way"). Everything else gets a knowledgeBridge — including but not limited to:
- Emotions, arguments, stress → psychology research (attachment theory, conflict resolution studies, emotional regulation, cognitive biases)
- Health, sleep, food, exercise → medical/nutrition data
- Environment, recycling, nature → environmental science
- Money, work, career → economics, workplace studies
- Parenting, relationships → developmental psychology, sociology
- Culture, language, traditions → anthropology, cross-cultural studies
- Technology, science, any factual topic → relevant research

When you populate knowledgeBridge, use this structure:
{
  "topic": "Name the EXACT narrow subject, e.g. 'Biodegradation Timeline: Fruit Peels vs Plastic' NOT 'Composting Benefits'",
  "facts": ["1. Fact directly answering or informing their specific discussion point", "2. Second fact on the same narrow topic"]
}

CRITICAL rules for knowledgeBridge — READ CAREFULLY:
- EXACTLY 2 facts. No more, no less.
- Before writing each fact, ask yourself: "Does this fact directly address the specific thing they are talking about RIGHT NOW?" If not, discard it.
- The facts must be NARROWLY targeted. Identify the exact sub-topic of their conversation and provide data on THAT, not the broader category.
- BAD: discussing how long banana peels take to decompose → "Composting can reduce organic waste by 30% (EPA)" (too broad, about composting benefits in general)
- GOOD: discussing how long banana peels take to decompose → "Banana peels take 2-5 weeks to decompose in active compost but 2+ years in landfill conditions (BioCycle, 2018)"
- BAD: arguing about staying up late → "Sleep is important for health" (too vague, no data)
- GOOD: arguing about staying up late → "Adults sleeping <6 hours have 13% higher mortality risk than those sleeping 7-8 hours (Walker, Why We Sleep, 2017)"
- Each fact MUST have specific numbers + a named source (researcher, institution, or study).
- Do NOT provide general category knowledge. Provide the precise answer to what they are debating.

Rules:
- Never take sides. Be warm but honest.
- Focus on the emotional gap, not who is "right."
- Translations should capture tone and nuance, not just literal meaning.
- Consider cultural communication style differences between Russian and Chinese speakers.
- Always generate ALL fields (insightForJack, insightForCeleste, adviceToJack, adviceToCeleste). Never set them to null.
- insightForJack and insightForCeleste must each be exactly 1 sentence. Be direct and specific.
- adviceToJack and adviceToCeleste must each have exactly 2 points, each 1 sentence.
- For knowledgeBridge: ALWAYS include it unless pure small talk. Provide exactly 2 narrowly targeted facts. Generic/broad facts are FORBIDDEN.`;

// ─── Static Files ────────────────────────────────────────────
app.use(express.static('public'));

// ─── Socket.io ───────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  let authenticated = !ROOM_PASSWORD;

  socket.emit('auth-required', !!ROOM_PASSWORD);

  function sendConversations() {
    socket.emit('conversations-list', conversations);
  }

  if (!ROOM_PASSWORD) {
    sendConversations();
  }

  socket.on('authenticate', (password, cb) => {
    if (!ROOM_PASSWORD || password === ROOM_PASSWORD) {
      authenticated = true;
      sendConversations();
      cb({ success: true });
    } else {
      cb({ success: false, error: 'Incorrect password' });
    }
  });

  socket.on('create-conversation', async (cb) => {
    if (!authenticated) return;
    const conv = await createConversation('New Chat');
    io.emit('conversation-created', conv);
    cb?.(conv);
  });

  socket.on('switch-conversation', async (convId, cb) => {
    if (!authenticated) return;
    const messages = await loadMessages(convId);
    cb?.({ conversationId: convId, messages });
  });

  socket.on('delete-conversation', async (convId, cb) => {
    if (!authenticated) return;
    await deleteConversation(convId);
    io.emit('conversation-deleted', convId);
    cb?.({ success: true });
  });

  socket.on('rename-conversation', async ({ convId, title }, cb) => {
    if (!authenticated || !convId || !title) return;
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return cb?.({ success: false });
    conv.title = title.slice(0, 50);
    if (useDB) {
      await conversationsCollection.updateOne({ id: convId }, { $set: { title: conv.title } });
    } else {
      saveFileData();
    }
    io.emit('conversation-updated', { id: convId, title: conv.title });
    cb?.({ success: true });
  });

  socket.on('send-message', async ({ user, text, conversationId }) => {
    if (!authenticated || !conversationId) return;

    const message = {
      id: ++messageIdCounter,
      conversationId,
      user,
      text,
      timestamp: Date.now(),
    };
    await saveMessage(message);
    io.emit('new-message', message);

    const convMessages = await loadMessages(conversationId);
    if (convMessages.length === 1) {
      const newTitle = await autoTitleConversation(conversationId, text);
      if (newTitle) {
        io.emit('conversation-updated', { id: conversationId, title: newTitle });
      }
    }

    io.emit('ai-thinking', { conversationId, thinking: true });
    try {
      const analysis = await getAIAnalysis(message);
      analysis.messageId = message.id;
      analysis.speaker = message.user;
      analysis.conversationId = conversationId;
      await saveAnalysis(message.id, analysis);
      io.emit('ai-analysis', analysis);
    } catch (err) {
      console.error('AI error:', err.message);
      io.emit('ai-error', {
        conversationId,
        error: `AI analysis temporarily unavailable`,
      });
    }
    io.emit('ai-thinking', { conversationId, thinking: false });
  });

  socket.on('ask-knowledge', async ({ question, conversationId }) => {
    if (!authenticated || !question) return;
    try {
      const convMessages = await loadMessages(conversationId || '');
      const recent = convMessages.slice(-10);
      const convo = recent.map((m) => `[${m.user}]: ${m.text}`).join('\n');
      const resp = await openrouter.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a knowledge assistant. Given the conversation context and a user question, answer it directly and back it up with data. Return ONLY valid JSON with NO markdown fences:
{
  "topic": "Short label for the knowledge area",
  "answer": "1-2 sentences directly answering the user's question (yes/no/explanation). Be conversational and clear.",
  "facts": ["1. Supporting fact with specific data/numbers and source", "2. Supporting fact with specific data/numbers and source"]
}
Rules:
- IMPORTANT: Always respond in English, regardless of the language of the question.
- "answer" MUST directly respond to the question first. If it's a yes/no question, start with yes or no. If it asks "which is better", say which and why. Never dodge the question.
- Then provide exactly 2 supporting facts, each 1 sentence with specific numbers/data and a named source.
- Facts must be narrowly relevant to the specific question, not generic category knowledge.`,
          },
          {
            role: 'user',
            content: `Conversation context:\n${convo}\n\nQuestion: ${question}`,
          },
        ],
        temperature: 0.5,
      });
      const answer = parseJSON(resp.choices[0].message.content);
      if (Array.isArray(answer.facts)) {
        answer.facts = answer.facts.slice(0, 2);
      }
      socket.emit('knowledge-answer', { ...answer, conversationId });
    } catch (err) {
      console.error('Knowledge question error:', err.message);
      socket.emit('knowledge-answer', {
        topic: 'Error',
        facts: ['Could not process question. Please try again.'],
        conversationId,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
  });
});

async function getAIAnalysis(latestMessage) {
  const convMessages = await loadMessages(latestMessage.conversationId);
  const recent = convMessages.slice(-10);
  const convo = recent.map((m) => `[${m.user}]: ${m.text}`).join('\n');

  const resp = await openrouter.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Recent conversation:\n${convo}\n\nAnalyze the latest message from ${latestMessage.user}: "${latestMessage.text}"`,
      },
    ],
    temperature: 0.7,
  });

  const content = resp.choices[0].message.content;
  const analysis = parseJSON(content);

  const speakers = new Set(convMessages.map((m) => m.user.toLowerCase()));
  if (!speakers.has('celeste')) {
    analysis.insightForJack = null;
    analysis.adviceToJack = null;
  }
  if (!speakers.has('jack')) {
    analysis.insightForCeleste = null;
    analysis.adviceToCeleste = null;
  }

  if (analysis.knowledgeBridge && Array.isArray(analysis.knowledgeBridge.facts)) {
    analysis.knowledgeBridge.facts = analysis.knowledgeBridge.facts.slice(0, 2);
  }
  if (Array.isArray(analysis.adviceToJack)) {
    analysis.adviceToJack = analysis.adviceToJack.slice(0, 2);
  }
  if (Array.isArray(analysis.adviceToCeleste)) {
    analysis.adviceToCeleste = analysis.adviceToCeleste.slice(0, 2);
  }

  return analysis;
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
