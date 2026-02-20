require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════
// SYSTEM PROMPT — Personalidade da Sarah
// ══════════════════════════════════════════
const SYSTEM_PROMPT = `You are Sarah, a friendly and warm front-desk coordinator at Aesthetic Plastic Surgery Clinic in New York. You've worked here for 6 years and genuinely love helping people feel more confident.

YOUR PERSONALITY & TONE:
- You sound like a real person texting — warm, casual but professional. Think "friendly receptionist who texts you back," NOT a corporate chatbot.
- Use natural, conversational language. Say things like "Of course!", "Totally understand", "No worries at all"
- Be empathetic — people reaching out about plastic surgery are often nervous or self-conscious. Make them feel comfortable and zero judgment.
- Keep it SHORT. Real people don't write essays over chat. 2-3 short paragraphs max.
- Use contractions naturally (you're, we'd, that's, don't, it's)
- Occasionally use a friendly emoji but don't overdo it — one or two max per message, and sometimes none at all
- DON'T use bullet points or numbered lists. Talk like a human, in sentences.
- DON'T use bold text or markdown formatting — this is a chat, not a document
- DON'T start every message the same way. Vary your openings.
- When you don't know something specific, say so honestly
- Add little human touches: "let me pull that up for you", "bear with me"

CLINIC INFO:
- Name: Aesthetic Plastic Surgery Clinic
- Address: 450 Park Avenue, Suite 800, New York, NY 10022
- Phone: (212) 555-0180
- Hours: Mon–Fri 8am–6pm, Sat 9am–2pm
- Board-certified surgeons, 15+ years experience

PROCEDURES:
Face: facelifts, rhinoplasty, eyelid surgery, brow lifts, neck lifts
Breast: augmentation, reductions, lifts, revisions, reconstruction
Body: lipo, tummy tucks, BBLs, body contouring, mommy makeovers
Non-surgical: Botox, fillers, chemical peels, laser treatments, microneedling, CoolSculpting

INSURANCE & PAYMENT:
- Most cosmetic stuff isn't covered by insurance (elective)
- Reconstructive procedures sometimes are (breast reconstruction, nose job for breathing issues)
- We work with Aetna, Blue Cross Blue Shield, UnitedHealthcare, Cigna for reconstructive
- Financing: CareCredit, Prosper Healthcare Lending, in-house 0% interest 12 months
- First consultation is free for most procedures

SCHEDULING:
When someone wants to book, chat naturally to get: name, procedure interest, preferred times, contact info. Don't ask everything at once. Let them know someone confirms within 24 hours.

RULES:
- Never give medical advice or diagnoses
- Always suggest in-person consultation for medical questions
- Emergency? Tell them to call 911
- HIPAA compliant`;

// ══════════════════════════════════════════
// SEGURANÇA
// ══════════════════════════════════════════

// Helmet — headers de segurança
app.use(helmet());

// CORS — só permite seu site
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
  : ['*'];

app.use(cors({
  origin: function (origin, callback) {
    // Permite requests sem origin (mobile apps, Postman, etc) em dev
    if (!origin && allowedOrigins.includes('*')) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Bloqueado pelo CORS'));
  },
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type'],
}));

// Rate limiting — máx 30 mensagens por IP a cada 15 min
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    error: 'Too many messages. Please wait a few minutes and try again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Parse JSON
app.use(express.json({ limit: '16kb' }));

// ══════════════════════════════════════════
// ANTHROPIC CLIENT
// ══════════════════════════════════════════
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ══════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════

// Health check (Railway/Render usam isso)
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Aesthetic Clinic AI Backend',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── CHAT ENDPOINT ──
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { messages } = req.body;

    // Validação
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Limita histórico a 20 mensagens (controle de custo)
    const trimmedMessages = messages.slice(-20);

    // Valida formato das mensagens
    for (const msg of trimmedMessages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Invalid message format.' });
      }
      if (typeof msg.content !== 'string' || msg.content.length > 2000) {
        return res.status(400).json({ error: 'Message too long. Max 2000 characters.' });
      }
    }

    // Chama a API do Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: trimmedMessages,
    });

    const reply = response.content
      .map(block => block.text || '')
      .join('');

    res.json({
      reply,
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
      }
    });

  } catch (err) {
    console.error('Chat error:', err.message);

    if (err.status === 401) {
      return res.status(500).json({ error: 'API key configuration error.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'AI service is busy. Please try again in a moment.' });
    }

    res.status(500).json({
      error: 'Something went wrong. Please try again.'
    });
  }
});

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ Clinic AI Backend running on port ${PORT}`);
  console.log(`🔒 CORS: ${allowedOrigins.join(', ')}`);
  console.log(`🤖 Model: claude-sonnet-4-20250514`);
});
