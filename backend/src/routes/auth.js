'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { AppError } = require('../errors');
const asyncHandler = require('../asyncHandler');
const { signToken, requireAuth } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hash factice : on le compare quand l'e-mail n'existe pas, pour que la réponse
// prenne le même temps (empêche de deviner quels e-mails ont un compte).
const DUMMY_HASH = bcrypt.hashSync('mot-de-passe-factice', 12);

/** Lit les champs e-mail / mot de passe en refusant tout ce qui n'est pas un texte. */
function credentials(req) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw new AppError(400, 'INVALID_CREDENTIALS_FORMAT', 'E-mail et mot de passe doivent être des textes.');
  }
  return { email: body.email.trim().toLowerCase(), password: body.password };
}

router.post(
  '/auth/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    if (process.env.ALLOW_REGISTRATION === 'false') {
      throw new AppError(403, 'REGISTRATION_CLOSED', 'Les inscriptions sont fermées.');
    }
    const { email, password } = credentials(req);

    if (!EMAIL_RE.test(email) || email.length > 190) {
      throw new AppError(400, 'INVALID_EMAIL', 'Adresse e-mail invalide.');
    }
    // bcrypt ne lit que les 72 premiers octets : on refuse plus long plutôt que de tronquer en silence.
    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new AppError(400, 'WEAK_PASSWORD', 'Le mot de passe doit contenir au moins 8 caractères et 72 octets au plus.');
    }

    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, plan, token_version',
        [email, hash]
      );
      const { token_version: tv, ...user } = rows[0];
      res.status(201).json({ token: signToken(user.id, tv), user });
    } catch (err) {
      if (err.code === '23505') throw new AppError(409, 'EMAIL_TAKEN', 'Un compte existe déjà avec cet e-mail.');
      throw err;
    }
  })
);

router.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = credentials(req);

    const { rows } = await pool.query('SELECT id, email, plan, password_hash, token_version FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, 'BAD_CREDENTIALS', 'E-mail ou mot de passe incorrect.');

    res.json({ token: signToken(user.id, user.token_version), user: { id: user.id, email: user.email, plan: user.plan } });
  })
);

/**
 * POST /api/auth/logout : déconnecte l'utilisateur sur TOUS ses appareils.
 * Tous les tokens émis jusqu'ici deviennent invalides ; il faudra se reconnecter.
 */
router.post(
  '/auth/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  })
);

/** GET /api/auth/me : utilisateur connecté et quota (sert au frontend pour vérifier que la session est valide). */
router.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, email, plan, monthly_quota, generations_used_this_month, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    const u = rows[0];
    res.json({
      user: { id: u.id, email: u.email, plan: u.plan, created_at: u.created_at },
      quota: { monthly: u.monthly_quota, used: u.generations_used_this_month }
    });
  })
);

module.exports = router;
