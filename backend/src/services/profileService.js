'use strict';

const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const str = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') throw new AppError(400, 'INVALID_PROFILE', 'Un champ texte contient un objet ou une liste.');
  const s = String(v).replace(/\u0000/g, '').trim();
  if (s.length > MAX_TEXT) throw new AppError(400, 'INVALID_PROFILE', `Un champ dépasse ${MAX_TEXT} caractères.`);
  return s === '' ? null : s;
};
const reqStr = (v, label) => {
  const s = str(v);
  if (!s) throw new AppError(400, 'INVALID_PROFILE', `Champ obligatoire manquant : ${label}.`);
  return s;
};
const date = (v, label) => {
  const s = str(v);
  if (s && !DATE_RE.test(s)) {
    throw new AppError(400, 'INVALID_PROFILE', `Date invalide pour ${label} : utilise le format AAAA-MM (ex. 2024-09).`);
  }
  return s;
};
const MAX_ITEMS = 50;
const MAX_TEXT = 3000;
const list = (v, label) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(400, 'INVALID_PROFILE', `${label} doit être une liste.`);
  if (v.length > MAX_ITEMS) throw new AppError(400, 'INVALID_PROFILE', `${label} : ${MAX_ITEMS} éléments maximum.`);
  return v;
};
// Chaque élément d'une liste doit être un objet (sinon e.school sur null ferait planter le serveur).
const objList = (v, label) =>
  list(v, label).map((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) {
      throw new AppError(400, 'INVALID_PROFILE', `${label} : chaque élément doit être un objet.`);
    }
    return x;
  });
const strList = (v, label) =>
  list(v, label)
    .map((x) => str(x))
    .filter(Boolean);

const strLimited = (v, label, max) => {
  const items = strList(v, label);
  if (items.length > max) throw new AppError(400, 'INVALID_PROFILE', `${label} : ${max} éléments maximum.`);
  return items;
};

/** Lit le profil maître complet d'un utilisateur (ou null s'il n'existe pas encore). */
async function loadProfile(userId) {
  const { rows } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  if (!rows.length) return null;
  const p = rows[0];

  const q = async (sql) => (await pool.query(sql, [p.id])).rows;
  const educations = await q(
    'SELECT school, degree, start_date, end_date, details FROM educations WHERE profile_id = $1 ORDER BY sort_order, id'
  );
  const experiences = await q(
    'SELECT company, role, location, start_date, end_date, bullets FROM experiences WHERE profile_id = $1 ORDER BY sort_order, id'
  );
  const projects = await q(
    'SELECT name, description, technologies, bullets, url FROM projects WHERE profile_id = $1 ORDER BY sort_order, id'
  );
  const skills = await q('SELECT category, name FROM skills WHERE profile_id = $1 ORDER BY category, id');
  const languages = await q('SELECT name, level FROM languages WHERE profile_id = $1 ORDER BY id');

  return {
    full_name: p.full_name,
    headline: p.headline,
    email: p.email,
    phone: p.phone,
    city: p.city,
    country: p.country,
    linkedin_url: p.linkedin_url,
    github_url: p.github_url,
    portfolio_url: p.portfolio_url,
    base_summary: p.base_summary,
    strengths: p.strengths || [],
    interests: p.interests || [],
    educations,
    experiences,
    projects,
    skills,
    languages
  };
}

/** Remplace entièrement le profil maître (en une transaction). */
async function saveProfile(userId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'INVALID_PROFILE', 'Profil invalide.');

  const base = {
    full_name: reqStr(input.full_name, 'nom complet'),
    headline: str(input.headline),
    email: str(input.email),
    phone: str(input.phone),
    city: str(input.city),
    country: str(input.country),
    linkedin_url: str(input.linkedin_url),
    github_url: str(input.github_url),
    portfolio_url: str(input.portfolio_url),
    base_summary: str(input.base_summary)
  };
  // Accepte aussi les clés françaises (atouts, centre d'intérêt / centres d'intérêt).
  const strengths = strLimited(input.strengths ?? input.atouts, 'atouts', 8);
  const interests = strLimited(input.interests ?? input["centres d'intérêt"] ?? input["centre d'intérêt"], "centres d'intérêt", 10);

  const educations = objList(input.educations, 'educations').map((e, i) => ({
    school: reqStr(e.school, `formation ${i + 1} : établissement`),
    degree: reqStr(e.degree, `formation ${i + 1} : diplôme`),
    start_date: date(e.start_date, `formation ${i + 1}`),
    end_date: date(e.end_date, `formation ${i + 1}`),
    details: str(e.details)
  }));

  const experiences = objList(input.experiences, 'experiences').map((e, i) => ({
    company: reqStr(e.company, `expérience ${i + 1} : entreprise`),
    role: reqStr(e.role, `expérience ${i + 1} : poste`),
    location: str(e.location),
    start_date: date(e.start_date, `expérience ${i + 1}`),
    end_date: date(e.end_date, `expérience ${i + 1}`),
    bullets: strList(e.bullets, `expérience ${i + 1} : réalisations`)
  }));

  const projects = objList(input.projects, 'projects').map((p, i) => ({
    name: reqStr(p.name, `projet ${i + 1} : nom`),
    description: reqStr(p.description, `projet ${i + 1} : description`),
    technologies: strList(p.technologies, `projet ${i + 1} : technologies`),
    bullets: strList(p.bullets, `projet ${i + 1} : réalisations`),
    url: str(p.url)
  }));

  const seen = new Set();
  const skills = [];
  objList(input.skills, 'skills').forEach((s, i) => {
    const name = reqStr(s.name, `compétence ${i + 1} : nom`);
    if (seen.has(name)) return;
    seen.add(name);
    skills.push({ category: reqStr(s.category, `compétence ${i + 1} : catégorie`), name });
  });

  const languages = objList(input.languages, 'languages').map((l, i) => ({
    name: reqStr(l.name, `langue ${i + 1} : nom`),
    level: reqStr(l.level, `langue ${i + 1} : niveau`)
  }));

  await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO profiles (user_id, full_name, headline, email, phone, city, country,
                             linkedin_url, github_url, portfolio_url, base_summary, strengths, interests, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name, headline = EXCLUDED.headline, email = EXCLUDED.email,
         phone = EXCLUDED.phone, city = EXCLUDED.city, country = EXCLUDED.country,
         linkedin_url = EXCLUDED.linkedin_url, github_url = EXCLUDED.github_url,
         portfolio_url = EXCLUDED.portfolio_url, base_summary = EXCLUDED.base_summary,
         strengths = EXCLUDED.strengths, interests = EXCLUDED.interests,
         updated_at = NOW()
       RETURNING id`,
      [
        userId, base.full_name, base.headline, base.email, base.phone, base.city, base.country,
        base.linkedin_url, base.github_url, base.portfolio_url, base.base_summary,
        JSON.stringify(strengths), JSON.stringify(interests)
      ]
    );
    const pid = rows[0].id;

    for (const table of ['educations', 'experiences', 'projects', 'skills', 'languages']) {
      await c.query(`DELETE FROM ${table} WHERE profile_id = $1`, [pid]);
    }

    for (const [i, e] of educations.entries()) {
      await c.query(
        'INSERT INTO educations (profile_id, school, degree, start_date, end_date, details, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [pid, e.school, e.degree, e.start_date, e.end_date, e.details, i]
      );
    }
    for (const [i, e] of experiences.entries()) {
      await c.query(
        'INSERT INTO experiences (profile_id, company, role, location, start_date, end_date, bullets, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
        [pid, e.company, e.role, e.location, e.start_date, e.end_date, JSON.stringify(e.bullets), i]
      );
    }
    for (const [i, p] of projects.entries()) {
      await c.query(
        'INSERT INTO projects (profile_id, name, description, technologies, bullets, url, sort_order) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',
        [pid, p.name, p.description, JSON.stringify(p.technologies), JSON.stringify(p.bullets), p.url, i]
      );
    }
    for (const s of skills) {
      await c.query('INSERT INTO skills (profile_id, category, name) VALUES ($1,$2,$3)', [pid, s.category, s.name]);
    }
    for (const l of languages) {
      await c.query('INSERT INTO languages (profile_id, name, level) VALUES ($1,$2,$3)', [pid, l.name, l.level]);
    }
  });

  return loadProfile(userId);
}

module.exports = { loadProfile, saveProfile };
