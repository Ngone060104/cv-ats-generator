'use strict';

const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { AppError } = require('../errors');

/** Le token contient la « version » de session de l'utilisateur : la déconnexion l'incrémente et invalide tous les anciens tokens. */
function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: String(userId), tv: tokenVersion }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'Connexion requise.'));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(new AppError(401, 'AUTH_INVALID', 'Session expirée, reconnecte-toi.'));
  }

  const id = Number(payload.sub);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return next(new AppError(401, 'AUTH_INVALID', 'Session expirée, reconnecte-toi.'));
  }

  try {
    const { rows } = await pool.query('SELECT token_version FROM users WHERE id = $1', [id]);
    // Les tokens émis avant l'ajout de la déconnexion n'ont pas de « tv » : ils valent 0.
    if (!rows.length || rows[0].token_version !== (payload.tv ?? 0)) {
      return next(new AppError(401, 'AUTH_INVALID', 'Session expirée, reconnecte-toi.'));
    }
  } catch (err) {
    return next(err); // base indisponible : géré par le gestionnaire central (503)
  }

  req.userId = id;
  next();
}

module.exports = { signToken, requireAuth };
