'use strict';

const jwt = require('jsonwebtoken');
const { AppError } = require('../errors');

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'Connexion requise.'));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const id = Number(payload.sub);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('bad sub');
    req.userId = id;
    next();
  } catch {
    next(new AppError(401, 'AUTH_INVALID', 'Session expirée, reconnecte-toi.'));
  }
}

module.exports = { signToken, requireAuth };
