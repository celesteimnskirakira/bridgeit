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
  "insightForJack": "1 sentence in English. Directly tell Jack what Celeste is feeling and what she actually needs right now.",
  "insightForCeleste": "1 sentence in English. Directly tell Celeste what Jack is feeling and what he actually needs right now.",
  "adviceToJack": ["1. One actionable sentence for Jack", "2. One actionable sentence for Jack"],
  "adviceToCeleste": ["1. One actionable sentence for Celeste", "2. One actionable sentence for Celeste"],
  "knowledgeBridge": null,
  "translations": {
    "zh": "Natural Chinese translation of the latest message",
    "en": "Natural English translation of the latest message",
    "ru": "Natural Russian translation of the latest message"
  }
}

The "knowledgeBridge" field is OPTIONAL. Set it to null when the conversation is purely logistical with no topical content. Populate it whenever the conversation touches on ANY topic with a factual, scientific, cultural, psychological, environmental, or health-related dimension.

When you DO populate knowledgeBridge, use this structure:
{
  "topic": "A short label, e.g. 'Seed Degradation in Soil'",
  "facts": ["1. Specific data point or research finding with numbers/timeframes, e.g. 'Fruit peels decompose in 2-5 weeks in active compost, but take 6+ months in landfill (EPA, 2022)'", "2. Another concrete fact or statistic from research", "3. A third data point if relevant"]
}

CRITICAL rules for knowledgeBridge.facts:
- Each point MUST contain specific numbers, timeframes, percentages, or verifiable data — NOT opinions or vague statements.
- Cite sources where possible (research institutions, government agencies, published studies).
- Focus on facts directly relevant to what they are discussing.
- 2-3 points maximum, each 1 sentence.

Rules:
- Never take sides. Be warm but honest.
- Focus on the emotional gap, not who is "right."
- Translations should capture tone and nuance, not just literal meaning.
- Consider cultural communication style differences between Russian and Chinese speakers.
- If there's only one message so far, focus on reading the speaker's emotional state and setting a supportive tone.
- insightForJack and insightForCeleste must each be exactly 1 sentence. Be direct and specific.
- adviceToJack and adviceToCeleste must each have exactly 2 points. Each point is 1 sentence.
- For knowledgeBridge: include it whenever the conversation touches on ANY topic with a factual dimension. Provide real data, not opinions. Skip it ONLY for purely logistical messages or brief emotional exchanges with no topical content.`;

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
  return parseJSON(content);
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
