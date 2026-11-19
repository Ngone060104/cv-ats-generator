'use strict';

/**
 * Éléments communs aux exports PDF et DOCX : libellés, mise en forme du texte
 * et conversion du CV structuré en sections neutres (une seule colonne, ATS).
 */

const LABELS = {
  fr: {
    summary: 'RÉSUMÉ',
    skills: 'COMPÉTENCES',
    experience: 'EXPÉRIENCE PROFESSIONNELLE',
    projects: 'PROJETS',
    education: 'FORMATION',
    languages: 'LANGUES',
    strengths: 'ATOUTS',
    interests: "CENTRES D'INTÉRÊT",
    present: 'Présent',
    technologies: 'Technologies',
    subject: 'Objet',
    colon: ' : ',
    locale: 'fr-FR',
    dateLine: (city, date) => (city ? `${city}, le ${date}` : date)
  },
  en: {
    summary: 'SUMMARY',
    skills: 'SKILLS',
    experience: 'PROFESSIONAL EXPERIENCE',
    projects: 'PROJECTS',
    education: 'EDUCATION',
    languages: 'LANGUAGES',
    strengths: 'STRENGTHS',
    interests: 'INTERESTS',
    present: 'Present',
    technologies: 'Technologies',
    subject: 'Subject',
    colon: ': ',
    locale: 'en-GB',
    dateLine: (city, date) => (city ? `${city}, ${date}` : date)
  }
};

LABELS.it = {
  summary: 'PROFILO',
  skills: 'COMPETENZE',
  experience: 'ESPERIENZA PROFESSIONALE',
  projects: 'PROGETTI',
  education: 'FORMAZIONE',
  languages: 'LINGUE',
  strengths: 'PUNTI DI FORZA',
  interests: 'INTERESSI',
  present: 'Presente',
  technologies: 'Tecnologie',
  subject: 'Oggetto',
  colon: ': ',
  locale: 'it-IT',
  dateLine: (city, date) => (city ? `${city}, ${date}` : date)
};
LABELS.es = {
  summary: 'PERFIL',
  skills: 'COMPETENCIAS',
  experience: 'EXPERIENCIA PROFESIONAL',
  projects: 'PROYECTOS',
  education: 'FORMACIÓN',
  languages: 'IDIOMAS',
  strengths: 'PUNTOS FUERTES',
  interests: 'INTERESES',
  present: 'Actualidad',
  technologies: 'Tecnologías',
  subject: 'Asunto',
  colon: ': ',
  locale: 'es-ES',
  dateLine: (city, date) => (city ? `${city}, ${date}` : date)
};

const labels = (lang) => LABELS[LABELS[lang] ? lang : 'fr'];

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

function period(start, end, L) {
  const s = clean(start);
  const e = clean(end);
  if (!s && !e) return '';
  if (!s) return e;
  return `${s} - ${e || L.present}`;
}

/** Ligne de contact : localisation | e-mail | téléphone | liens (URL complètes, lisibles par les ATS). */
function contactLine(header) {
  return [header.location, header.email, header.phone, ...(header.links || [])]
    .map(clean)
    .filter(Boolean)
    .join('  |  ');
}

/**
 * Sections neutres, dans l'ordre standard ATS. Les sections vides sont omises.
 * Types : text (paragraphe), lines ([{label, text}]), entries ([{heading, sub, bullets}]).
 */
function cvSections(cv, L, opts = {}) {
  const split = !!opts.splitDates; // modèle « élégant » : dates sur une colonne à droite
  const sections = [];

  if (clean(cv.summary)) {
    sections.push({ title: L.summary, type: 'text', text: clean(cv.summary) });
  }

  const skillLines = (cv.skills || [])
    .filter((g) => g.items && g.items.length)
    .map((g) => ({ label: `${clean(g.category)}${L.colon}`, text: g.items.map(clean).filter(Boolean).join(', ') }));
  if (skillLines.length) sections.push({ title: L.skills, type: 'lines', lines: skillLines });

  const experiences = (cv.experiences || []).map((e) => ({
    heading: [clean(e.role), clean(e.company)].filter(Boolean).join(', '),
    sub: split ? clean(e.location) : [clean(e.location), period(e.start_date, e.end_date, L)].filter(Boolean).join('  |  '),
    date: split ? period(e.start_date, e.end_date, L) : '',
    bullets: (e.bullets || []).map(clean).filter(Boolean)
  }));
  if (experiences.length) sections.push({ title: L.experience, type: 'entries', entries: experiences });

  const projects = (cv.projects || []).map((p) => ({
    heading: clean(p.name),
    sub: p.technologies && p.technologies.length ? `${L.technologies}${L.colon}${p.technologies.map(clean).join(', ')}` : '',
    bullets: (p.bullets || []).map(clean).filter(Boolean)
  }));
  if (projects.length) sections.push({ title: L.projects, type: 'entries', entries: projects });

  const education = (cv.education || []).map((e) => ({
    heading: clean(e.degree),
    sub: split ? clean(e.school) : [clean(e.school), period(e.start_date, e.end_date, L)].filter(Boolean).join('  |  '),
    date: split ? period(e.start_date, e.end_date, L) : '',
    bullets: []
  }));
  if (education.length) sections.push({ title: L.education, type: 'entries', entries: education });

  const langs = (cv.languages || [])
    .map((l) => (clean(l.level) ? `${clean(l.name)} (${clean(l.level)})` : clean(l.name)))
    .filter(Boolean);
  if (langs.length) sections.push({ title: L.languages, type: 'text', text: langs.join(', ') });

  const strengths = (cv.strengths || []).map(clean).filter(Boolean);
  if (strengths.length) sections.push({ title: L.strengths, type: 'bullets', items: strengths });

  const interests = (cv.interests || []).map(clean).filter(Boolean);
  if (interests.length) sections.push({ title: L.interests, type: 'text', text: interests.join(', ') });

  return sections;
}

/** Sépare la lettre stockée ("objet\n\ncorps") en objet + paragraphes. */
function splitLetter(stored) {
  const parts = String(stored || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const subject = parts.length > 1 ? parts[0] : '';
  const paragraphs = parts.length > 1 ? parts.slice(1) : parts;
  return { subject, paragraphs };
}

function letterDateLine(header, L) {
  const city = clean(header.location).split(',')[0].trim();
  const date = new Date().toLocaleDateString(L.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return L.dateLine(city, date);
}

/** Lignes de l'expéditeur pour la lettre (sans la localisation, déjà dans la date). */
function senderLines(header) {
  return [clean(header.email), clean(header.phone), ...(header.links || []).map(clean)].filter(Boolean);
}

/** Nom de fichier simple et sûr (ASCII). */
function slug(text) {
  return (
    clean(text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'candidature'
  );
}

const TEMPLATES = ['classic', 'elegant'];

module.exports = { TEMPLATES, labels, clean, cvSections, contactLine, splitLetter, letterDateLine, senderLines, slug };
