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

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─── Persistence ─────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load chat history:', e.message);
  }
  return [];
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
  } catch (e) {
    console.error('Failed to save chat history:', e.message);
  }
}

const chatHistory = loadHistory();
let messageIdCounter = chatHistory.length > 0
  ? Math.max(...chatHistory.map((m) => m.id || 0))
  : 0;

// ─── AI Prompt ───────────────────────────────────────────────
const SYSTEM_PROMPT = `You are BridgeIt, an AI relationship mediator for a couple: Celeste and Jack.
Celeste communicates in Russian, Chinese, and English.
Jack communicates in Chinese, English, and Russian.

Your job: decode the emotions beneath words, restore charitable intent, and bridge the communication gap.

Analyze the latest message in the context of the recent conversation. Return ONLY valid JSON with NO markdown fences:

{
  "deepDecode": "What the latest speaker is REALLY feeling beneath their words — the hidden needs, fears, or desires driving the message. 2-3 sentences in English.",
  "intentRestore": "Reframe what the OTHER person likely meant or intended from a charitable, empathetic perspective. 2-3 sentences in English.",
  "adviceToJack": "Specific, actionable advice for Jack right now. 1-2 sentences in 中文.",
  "adviceToCeleste": "Specific, actionable advice for Celeste right now. 1-2 sentences in Russian.",
  "translations": {
    "zh": "Natural Chinese translation of the latest message (capture tone, not just literal meaning)",
    "en": "Natural English translation of the latest message",
    "ru": "Natural Russian translation of the latest message"
  }
}

Rules:
- Never take sides. Be warm but honest.
- Focus on the emotional gap, not who is "right."
- Translations should capture tone and nuance, not just literal meaning.
- Consider cultural communication style differences between Russian and Chinese speakers.
- If there's only one message so far, focus on reading the speaker's emotional state and setting a supportive tone.`;

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
    chatHistory.push(message);
    saveHistory();
    io.emit('new-message', message);

    io.emit('ai-thinking', true);
    try {
      const analysis = await getAIAnalysis(message);
      analysis.messageId = message.id;
      analysis.speaker = message.user;
      io.emit('ai-analysis', analysis);
    } catch (err) {
      console.error('AI error:', err.message);
      io.emit('ai-error', 'AI analysis temporarily unavailable');
    }
    io.emit('ai-thinking', false);
  });

  socket.on('clear-history', (password, cb) => {
    if (ROOM_PASSWORD && password !== ROOM_PASSWORD) {
      cb?.({ success: false });
      return;
    }
    chatHistory.length = 0;
    messageIdCounter = 0;
    saveHistory();
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
  return JSON.parse(s);
}

server.listen(PORT, () => {
  console.log(`BridgeIt running at http://localhost:${PORT}`);
  if (ROOM_PASSWORD) console.log('Room is password-protected');
  console.log(`Model: ${AI_MODEL}`);
  console.log(`Chat history: ${chatHistory.length} messages loaded`);
});
