'use strict';

const express = require('express');
const { pool } = require('../db');
const { AppError } = require('../errors');
const asyncHandler = require('../asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { renderCvPdf, renderLetterPdf } = require('../services/export/pdf');
const { renderCvDocx, renderLetterDocx } = require('../services/export/docx');
const { slug, TEMPLATES } = require('../services/export/shared');

const router = express.Router();

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
router.use(requireAuth);

const STATUSES = ['brouillon', 'postule', 'relance', 'entretien', 'refus', 'offre'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new AppError(400, 'INVALID_ID', 'Identifiant invalide.');
  return id;
}


/**
 * GET /api/applications?status=&q=&sort=recent|followup|interview
 * Liste pour le tableau de bord. q cherche dans l'entreprise et l'intitulé du poste.
 */
router.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const where = ['a.user_id = $1'];
    const params = [req.userId];

    if (req.query.status !== undefined) {
      const status = String(req.query.status);
      if (!STATUSES.includes(status)) {
        throw new AppError(400, 'INVALID_STATUS', `Statut invalide. Valeurs possibles : ${STATUSES.join(', ')}.`);
      }
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    if (req.query.q !== undefined) {
      const q = String(req.query.q).trim().slice(0, 100);
      if (q) {
        // On neutralise les jokers % _ saisis par l'utilisateur ; la valeur reste un paramètre SQL.
        params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
        where.push(`(o.company ILIKE $${params.length} OR o.job_title ILIKE $${params.length})`);
      }
    }

    const sort = String(req.query.sort || 'recent');
    const ORDER = {
      recent: 'a.created_at DESC',
      followup: 'a.follow_up_at ASC NULLS LAST, a.created_at DESC',
      interview: 'a.interview_at ASC NULLS LAST, a.created_at DESC'
    };
    if (!ORDER[sort]) {
      throw new AppError(400, 'INVALID_SORT', 'sort doit être "recent", "followup" ou "interview".');
    }

    const { rows } = await pool.query(
      `SELECT a.id, o.job_title, o.company, o.source_url, a.match_score, a.status,
              a.applied_at, a.follow_up_at, a.interview_at, a.contact_name, a.created_at,
              (a.follow_up_at IS NOT NULL AND a.follow_up_at <= CURRENT_DATE
                 AND a.status IN ('postule','relance')) AS follow_up_due
         FROM applications a JOIN job_offers o ON o.id = a.job_offer_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${ORDER[sort]}`,
      params
    );
    res.json({ applications: rows });
  })
);

/**
 * GET /api/applications/stats : chiffres du tableau de bord.
 * (déclarée AVANT /applications/:id, sinon "stats" serait pris pour un identifiant)
 */
router.get(
  '/applications/stats',
  asyncHandler(async (req, res) => {
    const counts = await pool.query(
      'SELECT status, COUNT(*)::int AS n FROM applications WHERE user_id = $1 GROUP BY status',
      [req.userId]
    );
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of counts.rows) byStatus[r.status] = r.n;

    const interviews = await pool.query(
      `SELECT a.id, o.company, o.job_title, a.interview_at, a.contact_name, a.contact_info
         FROM applications a JOIN job_offers o ON o.id = a.job_offer_id
        WHERE a.user_id = $1 AND a.interview_at >= NOW() AND a.status <> 'refus'
        ORDER BY a.interview_at ASC LIMIT 10`,
      [req.userId]
    );
    const followUps = await pool.query(
      `SELECT a.id, o.company, o.job_title, a.status, a.follow_up_at
         FROM applications a JOIN job_offers o ON o.id = a.job_offer_id
        WHERE a.user_id = $1 AND a.status IN ('postule','relance')
          AND a.follow_up_at IS NOT NULL AND a.follow_up_at <= CURRENT_DATE
        ORDER BY a.follow_up_at ASC LIMIT 20`,
      [req.userId]
    );

    const total = Object.values(byStatus).reduce((x, y) => x + y, 0);
    res.json({
      total,
      by_status: byStatus,
      upcoming_interviews: interviews.rows,
      follow_ups_due: followUps.rows
    });
  })
);

/** GET /api/applications/:id : détail complet (CV, lettre, mots-clés). */
router.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { rows } = await pool.query(
      `SELECT a.id, o.job_title, o.company, o.source_url, a.cv_json, a.cover_letter, a.match_score,
              a.keywords_matched, a.keywords_missing, a.status, a.applied_at, a.follow_up_at,
              a.notes, a.model_used, a.created_at, a.updated_at,
              a.interview_at, a.contact_name, a.contact_info, a.advice,
              o.raw_text AS offer_text, o.analysis AS offer_analysis
         FROM applications a JOIN job_offers o ON o.id = a.job_offer_id
        WHERE a.id = $1 AND a.user_id = $2`,
      [id, req.userId]
    );
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Candidature introuvable.');
    res.json({ application: rows[0] });
  })
);

/** PATCH /api/applications/:id : statut, dates, notes, et retouches du CV / de la lettre. */
router.patch(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const sets = [];
    const params = [];
    const add = (col, value, cast = '') => {
      params.push(value);
      sets.push(`${col} = $${params.length}${cast}`);
    };

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        throw new AppError(400, 'INVALID_STATUS', `Statut invalide. Valeurs possibles : ${STATUSES.join(', ')}.`);
      }
      add('status', body.status);
    }
    for (const col of ['applied_at', 'follow_up_at']) {
      if (body[col] !== undefined) {
        if (body[col] !== null && (typeof body[col] !== 'string' || !DATE_RE.test(body[col]) || Number.isNaN(Date.parse(body[col])))) {
          throw new AppError(400, 'INVALID_DATE', `${col} doit être au format AAAA-MM-JJ.`);
        }
        add(col, body[col]);
      }
    }
    const text = (col, max) => {
      const v = body[col];
      if (v !== null && typeof v !== 'string') throw new AppError(400, 'INVALID_INPUT', `${col} doit être un texte.`);
      if (v && v.length > max) throw new AppError(400, 'FIELD_TOO_LONG', `${col} est trop long (${max} caractères maximum).`);
      return v === null ? null : v.replace(/\u0000/g, '');
    };
    if (body.notes !== undefined) add('notes', text('notes', 5000));
    if (body.contact_name !== undefined) add('contact_name', text('contact_name', 150));
    if (body.contact_info !== undefined) add('contact_info', text('contact_info', 190));
    if (body.interview_at !== undefined) {
      let value = null;
      if (body.interview_at !== null) {
        const t = typeof body.interview_at === 'string' ? Date.parse(body.interview_at) : NaN;
        const year = new Date(t).getUTCFullYear();
        if (Number.isNaN(t) || year < 2000 || year > 2100) {
          throw new AppError(400, 'INVALID_DATE', 'interview_at doit être une date et heure valides (ex. 2026-12-03T10:30:00).');
        }
        value = new Date(t).toISOString();
      }
      add('interview_at', value);
    }
    if (body.cover_letter !== undefined) {
      if (body.cover_letter === null) throw new AppError(400, 'INVALID_INPUT', 'cover_letter ne peut pas être vide.');
      add('cover_letter', text('cover_letter', 10000));
    }
    if (body.cv_json !== undefined) {
      if (typeof body.cv_json !== 'object' || body.cv_json === null || Array.isArray(body.cv_json)) {
        throw new AppError(400, 'INVALID_CV', 'cv_json doit être un objet.');
      }
      const json = JSON.stringify(body.cv_json).replace(/\\u0000/g, '');
      if (json.length > 100000) throw new AppError(400, 'FIELD_TOO_LONG', 'cv_json est trop volumineux.');
      add('cv_json', json, '::jsonb');
    }

    if (!sets.length) throw new AppError(400, 'NOTHING_TO_UPDATE', 'Aucun champ à modifier.');

    // Petits automatismes : passer à « postulé » remplit la date de candidature si elle est vide ;
    // fixer une date d'entretien passe une candidature en attente au statut « entretien ».
    if (body.status === 'postule' && body.applied_at === undefined) {
      sets.push('applied_at = COALESCE(applied_at, CURRENT_DATE)');
    }
    if (body.interview_at && body.status === undefined) {
      sets.push("status = CASE WHEN status IN ('brouillon','postule','relance') THEN 'entretien'::application_status ELSE status END");
    }

    params.push(id, req.userId);
    const { rowCount } = await pool.query(
      `UPDATE applications SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
      params
    );
    if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Candidature introuvable.');
    res.json({ ok: true });
  })
);

/**
 * GET /api/applications/:id/export?type=cv|letter&format=pdf|docx&template=classic|elegant&lang=fr|en|it|es
 * Télécharge le CV ou la lettre (avec tes éventuelles retouches) au format ATS.
 */
router.get(
  '/applications/:id/export',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const type = String(req.query.type || 'cv');
    const format = String(req.query.format || 'pdf');
    if (!['cv', 'letter'].includes(type)) {
      throw new AppError(400, 'INVALID_TYPE', 'type doit être "cv" ou "letter".');
    }
    const template = String(req.query.template || 'classic');
    if (!TEMPLATES.includes(template)) {
      throw new AppError(400, 'INVALID_TEMPLATE', 'template doit être "classic" ou "elegant".');
    }
    if (!['pdf', 'docx'].includes(format)) {
      throw new AppError(400, 'INVALID_FORMAT', 'format doit être "pdf" ou "docx".');
    }

    const { rows } = await pool.query(
      `SELECT a.cv_json, a.cover_letter, o.company, o.job_title, o.analysis
         FROM applications a JOIN job_offers o ON o.id = a.job_offer_id
        WHERE a.id = $1 AND a.user_id = $2`,
      [id, req.userId]
    );
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Candidature introuvable.');

    const { company, job_title: jobTitle, analysis } = rows[0];
    let { cv_json: cv, cover_letter: letterText } = rows[0];
    const sourceLang = analysis && analysis.language === 'en' ? 'en' : 'fr';
    let lang = sourceLang;

    // ?lang=en|it|es|fr : télécharge la version traduite (créée avec POST /applications/:id/translate)
    if (req.query.lang !== undefined) {
      const wanted = String(req.query.lang).toLowerCase();
      if (!['fr', 'en', 'it', 'es'].includes(wanted)) {
        throw new AppError(400, 'INVALID_LANGUAGE', 'lang doit être "fr", "en", "it" ou "es".');
      }
      if (wanted !== sourceLang) {
        const tr = await pool.query(
          'SELECT cv_json, cover_letter FROM application_translations WHERE application_id = $1 AND user_id = $2 AND language = $3',
          [id, req.userId, wanted]
        );
        const t = tr.rows[0];
        const missing = !t || (type === 'cv' ? !t.cv_json : !t.cover_letter);
        if (missing) {
          throw new AppError(
            404,
            'TRANSLATION_NOT_FOUND',
            `Pas de ${type === 'cv' ? 'CV' : 'lettre'} traduit(e) dans cette langue : lance d'abord la traduction.`
          );
        }
        if (type === 'cv') cv = t.cv_json;
        else letterText = t.cover_letter;
        lang = wanted;
      }
    }
    const header = (cv && cv.header) || (rows[0].cv_json && rows[0].cv_json.header) || {};

    let buffer;
    if (type === 'cv') {
      buffer = format === 'pdf' ? await renderCvPdf(cv, lang, template) : await renderCvDocx(cv, lang, template);
    } else {
      const args = { header, letterText, lang, template };
      buffer = format === 'pdf' ? await renderLetterPdf(args) : await renderLetterDocx(args);
    }

    const suffix = lang !== sourceLang ? `_${lang.toUpperCase()}` : '';
    const filename = `${type === 'cv' ? 'CV' : 'Lettre'}_${slug(header.full_name)}_${slug(company || jobTitle)}${suffix}.${format}`;
    res.setHeader('Content-Type', MIME[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

/** DELETE /api/applications/:id */
router.delete(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { rowCount } = await pool.query('DELETE FROM applications WHERE id = $1 AND user_id = $2', [
      id,
      req.userId
    ]);
    if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Candidature introuvable.');
    res.json({ ok: true });
  })
);

module.exports = router;
