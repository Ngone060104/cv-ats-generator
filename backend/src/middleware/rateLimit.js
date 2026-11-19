'use strict';

const { rateLimit } = require('express-rate-limit');
const { AppError } = require('../errors');

const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

const base = (message) => ({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMIT', message))
});

/** Plafond général pour toute l'API (protège contre les rafales de requêtes). */
const globalLimiter = rateLimit({
  ...base('Trop de requêtes. Réessaie dans quelques minutes.'),
  windowMs: 15 * 60 * 1000,
  limit: num(process.env.RATE_LIMIT_GLOBAL, 600)
});

/** Connexions : seules les tentatives ÉCHOUÉES comptent (anti force brute sur les mots de passe). */
const loginLimiter = rateLimit({
  ...base('Trop de tentatives de connexion échouées. Réessaie dans 15 minutes.'),
  windowMs: 15 * 60 * 1000,
  limit: num(process.env.RATE_LIMIT_LOGIN_FAILS, 10),
  skipSuccessfulRequests: true
});

/** Créations de compte. */
const registerLimiter = rateLimit({
  ...base('Trop de créations de compte. Réessaie plus tard.'),
  windowMs: 60 * 60 * 1000,
  limit: num(process.env.RATE_LIMIT_REGISTER, 10)
});

/** Générations : chaque appel coûte de l'argent (API Claude), donc limite par utilisateur. */
const generateLimiter = rateLimit({
  ...base('Limite de générations atteinte pour cette heure. Réessaie plus tard.'),
  windowMs: 60 * 60 * 1000,
  limit: num(process.env.RATE_LIMIT_GENERATE, 30),
  keyGenerator: (req) => `user:${req.userId}`
});

/** Traductions : chaque appel coûte aussi de l'argent. */
const translateLimiter = rateLimit({
  ...base('Limite de traductions atteinte pour cette heure. Réessaie plus tard.'),
  windowMs: 60 * 60 * 1000,
  limit: num(process.env.RATE_LIMIT_TRANSLATE, 40),
  keyGenerator: (req) => `user:${req.userId}`
});

module.exports = { globalLimiter, loginLimiter, registerLimiter, generateLimiter, translateLimiter };
