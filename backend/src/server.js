'use strict';

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { pool } = require('./db');
const { AppError, toHttpError } = require('./errors');
const { globalLimiter } = require('./middleware/rateLimit');

const app = express();

// Identifiant de requête : permet de retrouver une erreur précise dans le terminal.
app.use((req, res, next) => {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // en-têtes de sécurité, masque X-Powered-By
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200', // Angular en dev
    exposedHeaders: ['Content-Disposition', 'X-Request-Id']
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', globalLimiter);
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/profile'));
app.use('/api', require('./routes/generate'));
app.use('/api', require('./routes/applications'));
app.use('/api', require('./routes/translations'));

// Toute autre adresse (y compris hors /api) : 404 en JSON
app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route introuvable.')));

// Gestionnaire d'erreurs central : plus aucune page d'erreur HTML ni trace technique envoyée au client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const mapped = toHttpError(err);
  if (mapped && mapped.status < 500) {
    return res.status(mapped.status).json(mapped.body);
  }

  console.error(`[${req.id}] ${req.method} ${req.originalUrl}`, err);
  if (mapped) return res.status(mapped.status).json({ ...mapped.body, requestId: req.id });
  res.status(500).json({ error: 'Erreur interne du serveur.', code: 'INTERNAL', requestId: req.id });
});

async function start() {
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    process.exit(1);
  });

  const problems = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL manquant dans backend/.env');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    problems.push('JWT_SECRET manquant ou trop court (16 caractères minimum) dans backend/.env');
  }
  if (problems.length) {
    console.error('Configuration incomplète :\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('remplace')) {
    console.warn("Attention : ANTHROPIC_API_KEY n'est pas renseignée, la génération échouera.");
  }

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`Connexion PostgreSQL impossible (${err.message}). Vérifie DATABASE_URL dans backend/.env.`);
    process.exit(1);
  }

  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`API prête sur http://localhost:${port}`));
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Le port ${port} est déjà utilisé. Change PORT dans backend/.env ou arrête l'autre programme.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

if (require.main === module) start();

module.exports = { app };
