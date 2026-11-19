'use strict';

const express = require('express');
const { pool } = require('../db');
const { AppError } = require('../errors');
const asyncHandler = require('../asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { translateLimiter } = require('../middleware/rateLimit');
const { translateDocuments, LANGUAGES } = require('../services/translator');

const router = express.Router();
router.use(requireAuth);

const WHAT = ['cv', 'letter', 'both'];

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new AppError(400, 'INVALID_ID', 'Identifiant invalide.');
  return id;
}

/**
 * POST /api/applications/:id/translate
 * body: { language: "fr"|"en"|"it"|"es", what?: "cv"|"letter"|"both" }
 * Traduit le CV et/ou la lettre (avec tes retouches) et enregistre la version traduite.
 */
router.post(
  '/applications/:id/translate',
  translateLimiter,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const language = typeof body.language === 'string' ? body.language.toLowerCase() : '';
    const what = body.what === undefined ? 'both' : body.what;
    if (!LANGUAGES[language]) {
      throw new AppError(400, 'INVALID_LANGUAGE', `Langue non prise en charge. Valeurs possibles : ${Object.keys(LANGUAGES).join(', ')}.`);
    }
    if (!WHAT.includes(what)) {
      throw new AppError(400, 'INVALID_WHAT', 'what doit être "cv", "letter" ou "both".');
    }

    const { rows } = await pool.query(
      `SELECT a.cv_json, a.cover_letter, o.analysis
         FROM applications a JOIN job_offers o ON o.id = a.job_offer_id
        WHERE a.id = $1 AND a.user_id = $2`,
      [id, req.userId]
    );
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Candidature introuvable.');
    const sourceLang = rows[0].analysis && rows[0].analysis.language === 'en' ? 'en' : 'fr';
    if (language === sourceLang) {
      throw new AppError(400, 'SAME_LANGUAGE', `Cette candidature est déjà en ${LANGUAGES[sourceLang]}.`);
    }

    const { rows: quotaRows } = await pool.query(
      'SELECT monthly_quota, generations_used_this_month FROM users WHERE id = $1',
      [req.userId]
    );
    const quota = quotaRows[0];
    if (quota && quota.generations_used_this_month >= quota.monthly_quota) {
      throw new AppError(429, 'QUOTA_EXCEEDED', 'Quota atteint pour ce mois.');
    }

    const result = await translateDocuments({
      cv: rows[0].cv_json,
      coverLetter: rows[0].cover_letter,
      targetLang: language,
      sourceLang,
      what
    });

    await pool.query(
      `INSERT INTO application_translations (application_id, user_id, language, cv_json, cover_letter, model_used)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT (application_id, language) DO UPDATE SET
         cv_json = COALESCE(EXCLUDED.cv_json, application_translations.cv_json),
         cover_letter = COALESCE(EXCLUDED.cover_letter, application_translations.cover_letter),
         model_used = EXCLUDED.model_used, updated_at = NOW()`,
      [id, req.userId, language, result.cv ? JSON.stringify(result.cv) : null, result.cover_letter, result.model]
    );
    await pool.query('UPDATE users SET generations_used_this_month = generations_used_this_month + 1 WHERE id = $1', [
      req.userId
    ]);

    res.status(201).json({ language, cv: result.cv, cover_letter: result.cover_letter });
  })
);

/** GET /api/applications/:id/translations : versions traduites disponibles. */
router.get(
  '/applications/:id/translations',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { rows } = await pool.query(
      `SELECT t.language, (t.cv_json IS NOT NULL) AS has_cv, (t.cover_letter IS NOT NULL) AS has_letter, t.updated_at
         FROM application_translations t
        WHERE t.application_id = $1 AND t.user_id = $2
        ORDER BY t.language`,
      [id, req.userId]
    );
    res.json({ translations: rows });
  })
);

/** GET /api/applications/:id/translations/:lang : contenu d'une version traduite. */
router.get(
  '/applications/:id/translations/:lang',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { rows } = await pool.query(
      `SELECT language, cv_json, cover_letter, updated_at FROM application_translations
        WHERE application_id = $1 AND user_id = $2 AND language = $3`,
      [id, req.userId, String(req.params.lang).toLowerCase()]
    );
    if (!rows.length) throw new AppError(404, 'TRANSLATION_NOT_FOUND', 'Aucune traduction dans cette langue.');
    res.json({ translation: rows[0] });
  })
);

/** DELETE /api/applications/:id/translations/:lang */
router.delete(
  '/applications/:id/translations/:lang',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { rowCount } = await pool.query(
      'DELETE FROM application_translations WHERE application_id = $1 AND user_id = $2 AND language = $3',
      [id, req.userId, String(req.params.lang).toLowerCase()]
    );
    if (!rowCount) throw new AppError(404, 'TRANSLATION_NOT_FOUND', 'Aucune traduction dans cette langue.');
    res.json({ ok: true });
  })
);

module.exports = router;
