/**
 * NovaMed AI — backend entry.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const encounterRoutes = require('./routes/encounters');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: true,
  credentials: false,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
  ],
}));

app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// Static for uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Routes
app.use('/api/auth',       authRoutes);
app.use('/api/patients',   patientRoutes);
app.use('/api/encounters', encounterRoutes);
app.use('/api/admin',      adminRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`\n  NovaMed AI API`);
  console.log(`  ──────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  health:  /api/health`);

  const aiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  const aiProvider = (process.env.AI_PROVIDER || 'gemini').toUpperCase();
  if (aiKey) {
    console.log(`  AI augmentation: enabled (provider: ${aiProvider})`);
    console.log(`  ✅ API key detected — AI mode active.\n`);
  } else {
    console.log(`  AI augmentation: disabled (DB-only mode)`);
    console.log(`  ⚠️  No API key found. Add GROQ_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY to .env\n`);
  }
});
