'use strict';

/** Erreur « métier » avec un code HTTP et un code lisible par le front. */
class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Traduit une erreur du SDK Anthropic en message clair pour l'utilisatrice. */
function mapAnthropicError(err) {
  const status = err && err.status;
  const msg = String((err && err.message) || '');
  const ctor = (err && err.constructor && err.constructor.name) || '';

  if (ctor === 'APIConnectionTimeoutError') {
    return new AppError(504, 'AI_TIMEOUT', "L'API Claude a mis trop de temps à répondre. Réessaie dans un instant.");
  }
  if (status === 401) {
    return new AppError(
      502,
      'API_KEY_INVALID',
      "Clé API Claude invalide ou expirée. Crée une nouvelle clé dans la Claude Console, remplace ANTHROPIC_API_KEY dans backend/.env, puis redémarre le serveur."
    );
  }
  if (status === 403) {
    return new AppError(
      502,
      'API_FORBIDDEN',
      "Cette clé API n'a pas la permission d'utiliser ce modèle ou cet espace de travail. Vérifie la clé et le modèle (CLAUDE_MODEL) dans la Console."
    );
  }
  if (status === 400 && /credit balance|billing/i.test(msg)) {
    return new AppError(
      402,
      'NO_CREDIT',
      "Solde API insuffisant. Recharge ton crédit dans la section facturation de la Claude Console, puis réessaie (inutile de changer la clé)."
    );
  }
  if (status === 400) {
    const detail = (err.error && err.error.error && err.error.error.message) || msg;
    return new AppError(502, 'AI_BAD_REQUEST', `L'API Claude a refusé la requête : ${detail}`);
  }
  if (status === 404) {
    return new AppError(
      502,
      'MODEL_NOT_FOUND',
      `Modèle introuvable. Vérifie la valeur de CLAUDE_MODEL dans backend/.env (actuellement : ${process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'}).`
    );
  }
  if (status === 429) {
    return new AppError(429, 'RATE_LIMIT', "Trop de requêtes vers l'API Claude. Attends une minute puis réessaie.");
  }
  if (status === 529 || (status >= 500 && status < 600)) {
    return new AppError(503, 'AI_OVERLOADED', 'Le service Claude est momentanément surchargé. Réessaie dans quelques instants.');
  }
  if (!status) {
    return new AppError(503, 'AI_UNREACHABLE', "Impossible de joindre l'API Claude. Vérifie ta connexion internet.");
  }
  return null; // erreur non reconnue : traitée comme erreur interne
}

// Codes d'erreur PostgreSQL les plus courants → réponse HTTP claire (au lieu d'un 500).
const PG_ERRORS = {
  '22001': [400, 'FIELD_TOO_LONG', 'Un des champs est trop long.'],
  '22003': [400, 'VALUE_OUT_OF_RANGE', 'Une valeur numérique est hors limites.'],
  '22007': [400, 'INVALID_DATE', 'Date invalide.'],
  '22008': [400, 'INVALID_DATE', 'Date invalide.'],
  '22021': [400, 'INVALID_CHARACTERS', 'Le texte contient des caractères non autorisés.'],
  '22P05': [400, 'INVALID_CHARACTERS', 'Le texte contient des caractères non autorisés.'],
  '22P02': [400, 'INVALID_VALUE', 'Valeur invalide.'],
  '23502': [400, 'MISSING_FIELD', 'Un champ obligatoire est manquant.'],
  '23503': [401, 'AUTH_INVALID', 'Compte introuvable : reconnecte-toi.'],
  '23505': [409, 'CONFLICT', 'Cette donnée existe déjà.'],
  '23514': [400, 'INVALID_VALUE', 'Valeur invalide.']
};

const DB_DOWN_RE = /connection terminated|timeout exceeded when trying to connect|ECONNREFUSED|server closed the connection|the database system is/i;

/**
 * Convertit n'importe quelle erreur en { status, body } pour le client.
 * Renvoie null si l'erreur est inattendue (le gestionnaire central répond alors 500).
 */
function toHttpError(err) {
  if (!err) return null;

  if (err instanceof AppError) {
    return { status: err.status, body: { error: err.message, code: err.code, ...err.extra } };
  }

  // Erreurs de lecture du corps de la requête (body-parser)
  if (err.type === 'entity.parse.failed') {
    return { status: 400, body: { error: 'JSON invalide dans la requête.', code: 'BAD_JSON' } };
  }
  if (err.type === 'entity.too.large') {
    return { status: 413, body: { error: 'Requête trop volumineuse (1 Mo maximum).', code: 'PAYLOAD_TOO_LARGE' } };
  }
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return { status: 415, body: { error: 'Encodage de la requête non pris en charge.', code: 'UNSUPPORTED_ENCODING' } };
  }
  if (err.status >= 400 && err.status < 500 && err.expose) {
    return { status: err.status, body: { error: 'Requête invalide.', code: 'BAD_REQUEST' } };
  }

  // Erreurs PostgreSQL
  if (typeof err.code === 'string' && PG_ERRORS[err.code]) {
    const [status, code, error] = PG_ERRORS[err.code];
    return { status, body: { error, code } };
  }

  // Base de données injoignable
  const connectFailure =
    err.syscall === 'connect' && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(err.code);
  const pgUnavailable = typeof err.code === 'string' && /^(08|53|57P0)/.test(err.code);
  if (connectFailure || pgUnavailable || DB_DOWN_RE.test(String(err.message || ''))) {
    return {
      status: 503,
      body: { error: 'Base de données indisponible. Vérifie que PostgreSQL est démarré.', code: 'DB_UNAVAILABLE' }
    };
  }

  return null;
}

module.exports = { AppError, mapAnthropicError, toHttpError };
