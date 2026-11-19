'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const asyncHandler = require('../asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { fetchOfferText, OfferFetchError } = require('../services/offerFetcher');
const { generateApplication } = require('../services/generator');
const { loadProfile } = require('../services/profileService');
const { generateLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

/**
 * POST /api/generate
 * body: { url?: string, offerText?: string }
 * Utilise le profil maître enregistré, génère CV + lettre, sauvegarde la candidature.
 */
router.post(
  '/generate',
  generateLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    for (const key of ['url', 'offerText']) {
      if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
        throw new AppError(400, 'INVALID_INPUT', `${key} doit être un texte.`);
      }
    }
    const url = String(body.url || '').trim();
    const pasted = String(body.offerText || '').trim();
    if (url.length > 2048) throw new AppError(400, 'URL_TOO_LONG', 'Le lien est trop long (2048 caractères maximum).');
    if (pasted.length > 30000) {
      throw new AppError(400, 'OFFER_TOO_LONG', "Le texte de l'offre est trop long (30 000 caractères maximum).");
    }
    if (!url && !pasted) {
      throw new AppError(400, 'OFFER_MISSING', "Fournis un lien ou colle le texte de l'offre.");
    }

    const profile = await loadProfile(req.userId);
    if (!profile) {
      throw new AppError(400, 'PROFILE_MISSING', "Remplis d'abord ton profil maître avant de générer une candidature.");
    }

    const { rows: quotaRows } = await pool.query(
      'SELECT monthly_quota, generations_used_this_month FROM users WHERE id = $1',
      [req.userId]
    );
    const quota = quotaRows[0];
    if (quota && quota.generations_used_this_month >= quota.monthly_quota) {
      throw new AppError(429, 'QUOTA_EXCEEDED', 'Quota de générations atteint pour ce mois.');
    }

    let offerText;
    if (pasted.length >= 100) {
      offerText = pasted.replace(/\u0000/g, '');
    } else if (url) {
      try {
        offerText = await fetchOfferText(url);
      } catch (err) {
        if (err instanceof OfferFetchError) {
          throw new AppError(422, err.code, err.message, { needsManualPaste: true });
        }
        throw err;
      }
    } else {
      throw new AppError(400, 'OFFER_TOO_SHORT', "Le texte de l'offre est trop court (100 caractères minimum).", {
        needsManualPaste: true
      });
    }

    const { data, warnings, model } = await generateApplication({
      profile,
      offerText,
      sourceUrl: url || null
    });

    const applicationId = await withTransaction(async (c) => {
      const offer = await c.query(
        `INSERT INTO job_offers (user_id, source_url, raw_text, company, job_title, analysis)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
        [
          req.userId,
          url || null,
          offerText,
          data.offer_analysis.company,
          data.offer_analysis.job_title,
          JSON.stringify(data.offer_analysis)
        ]
      );
      const app = await c.query(
        `INSERT INTO applications (user_id, job_offer_id, cv_json, cover_letter, match_score,
                                   keywords_matched, keywords_missing, advice, model_used)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9) RETURNING id`,
        [
          req.userId,
          offer.rows[0].id,
          JSON.stringify(data.cv),
          `${data.cover_letter.subject}\n\n${data.cover_letter.body}`,
          data.match.score,
          JSON.stringify(data.match.keywords_matched),
          JSON.stringify(data.match.keywords_missing),
          JSON.stringify(data.match.advice || []),
          model
        ]
      );
      await c.query(
        'UPDATE users SET generations_used_this_month = generations_used_this_month + 1 WHERE id = $1',
        [req.userId]
      );
      return app.rows[0].id;
    });

    res.status(201).json({ applicationId, ...data, warnings, model });
  })
);

module.exports = router;
