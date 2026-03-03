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

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');

let chatHistory = [];
let messageIdCounter = 0;

async function initDB() {
  if (!MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('bridgeit');
    messagesCollection = db.collection('messages');
    await messagesCollection.createIndex({ id: 1 }, { unique: true });
    useDB = true;
    console.log('Connected to MongoDB Atlas');
  } catch (err) {
    console.error('MongoDB connection failed, falling back to file storage:', err.message);
  }
}

async function loadHistory() {
  if (useDB) {
    const docs = await messagesCollection.find({}).sort({ id: 1 }).toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load chat history:', e.message);
  }
  return [];
}

function saveHistoryFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
  } catch (e) {
    console.error('Failed to save chat history:', e.message);
  }
}

async function saveMessage(message) {
  chatHistory.push(message);
  if (useDB) {
    try {
      await messagesCollection.insertOne({ ...message });
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  } else {
    saveHistoryFile();
  }
}

async function saveAnalysis(messageId, analysis) {
  const msg = chatHistory.find((m) => m.id === messageId);
  if (msg) msg.analysis = analysis;
  if (useDB) {
    try {
      await messagesCollection.updateOne({ id: messageId }, { $set: { analysis } });
    } catch (e) {
      console.error('DB update error:', e.message);
    }
  } else {
    saveHistoryFile();
  }
}

async function clearAllHistory() {
  chatHistory.length = 0;
  messageIdCounter = 0;
  if (useDB) {
    try {
      await messagesCollection.deleteMany({});
    } catch (e) {
      console.error('DB clear error:', e.message);
    }
  } else {
    saveHistoryFile();
  }
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
  "topic": "A short label that names the SPECIFIC subject they are discussing, e.g. 'Seed Decomposition Rates' not 'Environmental Awareness'",
  "facts": ["1. Concrete fact with data/numbers/source", "2. Another specific finding", "3. Third data point if relevant"]
}

CRITICAL rules for knowledgeBridge:
- The topic and facts MUST be directly about the SPECIFIC SUBJECT of their conversation. If they are discussing composting, provide composting data. If arguing about screen time, provide screen time research. Do NOT provide generic relationship/communication tips — that belongs in adviceToJack/adviceToCeleste.
- BAD example: discussing garbage sorting → facts about "communication styles" (off-topic)
- GOOD example: discussing garbage sorting → facts about "recycling contamination rates" or "landfill decomposition timelines"
- BAD example: arguing about sleep schedules → facts about "active listening" (off-topic)
- GOOD example: arguing about sleep schedules → facts about "sleep deprivation effects on health"
- Each fact MUST contain specific numbers, timeframes, percentages, or named research findings.
- Cite sources (researchers by name, institutions, published studies, government agencies).
- 2-3 points, each 1 sentence, numbered 1. 2. 3.

Rules:
- Never take sides. Be warm but honest.
- Focus on the emotional gap, not who is "right."
- Translations should capture tone and nuance, not just literal meaning.
- Consider cultural communication style differences between Russian and Chinese speakers.
- Always generate ALL fields (insightForJack, insightForCeleste, adviceToJack, adviceToCeleste). Never set them to null.
- insightForJack and insightForCeleste must each be exactly 1 sentence. Be direct and specific.
- adviceToJack and adviceToCeleste must each have exactly 2 points, each 1 sentence.
- For knowledgeBridge: ALWAYS include it unless the message is pure small talk ("hi", "ok", "on my way"). Even emotional conversations should get psychology/neuroscience research. When in doubt, include it.`;

// ─── Static Files ────────────────────────────────────────────
app.use(express.static('public'));

// ─── Socket.io ───────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  let authenticated = !ROOM_PASSWORD;

  socket.emit('auth-required', !!ROOM_PASSWORD);

  if (!ROOM_PASSWORD) {
    socket.emit('history', chatHistory);
  }

  socket.on('authenticate', (password, cb) => {
    if (!ROOM_PASSWORD || password === ROOM_PASSWORD) {
      authenticated = true;
      socket.emit('history', chatHistory);
      cb({ success: true });
    } else {
      cb({ success: false, error: 'Incorrect password' });
    }
  });

  socket.on('send-message', async ({ user, text }) => {
    if (!authenticated) return;

    const message = {
      id: ++messageIdCounter,
      user,
      text,
      timestamp: Date.now(),
    };
    await saveMessage(message);
    io.emit('new-message', message);

    io.emit('ai-thinking', true);
    try {
      const analysis = await getAIAnalysis(message);
      analysis.messageId = message.id;
      analysis.speaker = message.user;
      await saveAnalysis(message.id, analysis);
      io.emit('ai-analysis', analysis);
    } catch (err) {
      console.error('AI error:', err.message);
      const detail = process.env.NODE_ENV === 'production' ? '' : ` (${err.message})`;
      io.emit('ai-error', `AI analysis temporarily unavailable${detail}`);
    }
    io.emit('ai-thinking', false);
  });

  socket.on('clear-history', async (password, cb) => {
    if (ROOM_PASSWORD && password !== ROOM_PASSWORD) {
      cb?.({ success: false });
      return;
    }
    await clearAllHistory();
    io.emit('history-cleared');
    cb?.({ success: true });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
  });
});

async function getAIAnalysis(latestMessage) {
  const recent = chatHistory.slice(-10);
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

  const speakers = new Set(chatHistory.map((m) => m.user.toLowerCase()));
  if (!speakers.has('celeste')) {
    analysis.insightForJack = null;
    analysis.adviceToJack = null;
  }
  if (!speakers.has('jack')) {
    analysis.insightForCeleste = null;
    analysis.adviceToCeleste = null;
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
  chatHistory = await loadHistory();
  messageIdCounter =
    chatHistory.length > 0 ? Math.max(...chatHistory.map((m) => m.id || 0)) : 0;

  server.listen(PORT, () => {
    console.log(`BridgeIt running at http://localhost:${PORT}`);
    if (ROOM_PASSWORD) console.log('Room is password-protected');
    console.log(`Model: ${AI_MODEL}`);
    console.log(`Storage: ${useDB ? 'MongoDB Atlas' : 'Local file'}`);
    console.log(`Chat history: ${chatHistory.length} messages loaded`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
