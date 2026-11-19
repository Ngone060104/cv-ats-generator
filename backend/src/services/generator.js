'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const Ajv = require('ajv/dist/2020');
const outputSchema = require('../prompts/outputSchema.json');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../prompts/recruiterPrompt');
const { AppError, mapAnthropicError } = require('../errors');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180000, maxRetries: 2 });
const validate = new Ajv({ allErrors: true }).compile(outputSchema);

// Marge large : un CV + une lettre + l'analyse en JSON représentent plusieurs milliers de tokens.
const MAX_TOKENS = 16000;

const BAD_RESPONSE = (extra) =>
  new AppError(
    502,
    'BAD_AI_RESPONSE',
    "La réponse de l'IA était illisible. Réessaie : cela arrive rarement. Si cela se répète, copie le message affiché dans le terminal du serveur.",
    extra
  );

const TRUNCATED = (extra) =>
  new AppError(
    502,
    'AI_TRUNCATED',
    "La réponse de l'IA a été coupée avant la fin (trop longue). Réessaie ; si cela se répète, copie le message affiché dans le terminal du serveur.",
    extra
  );

/** Renvoie l'objet JSON contenu dans le texte, ou null s'il est absent ou invalide. */
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Journal local pour comprendre un échec (visible uniquement dans ton terminal). */
function logBadResponse(message, raw) {
  const types = (message.content || []).map((b) => b.type).join(',');
  console.error(
    `[generator] Réponse illisible : stop_reason=${message.stop_reason} blocs=[${types}] ` +
      `tokens=${JSON.stringify(message.usage || {})} caractères=${raw.length}`
  );
  console.error('[generator] DÉBUT :', raw.slice(0, 400).replace(/\n/g, '\\n'));
  console.error('[generator] FIN   :', raw.slice(-400).replace(/\n/g, '\\n'));
}

/**
 * Garde-fou anti-invention : toute compétence du CV doit exister dans le profil
 * (compétences ou technologies de projets). Sinon elle est retirée et signalée.
 */
function enforceNoInventedSkills(cv, profile) {
  const allowed = new Set();
  (profile.skills || []).forEach((s) => allowed.add(String(s.name).toLowerCase()));
  (profile.projects || []).forEach((p) =>
    (p.technologies || []).forEach((t) => allowed.add(String(t).toLowerCase()))
  );

  const warnings = [];
  cv.skills = cv.skills
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const ok = allowed.has(String(item).toLowerCase());
        if (!ok) warnings.push(`Compétence retirée car absente du profil : ${item}`);
        return ok;
      })
    }))
    .filter((group) => group.items.length > 0);
  return warnings;
}

async function generateApplication({ profile, offerText, sourceUrl }) {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(profile, offerText, outputSchema, sourceUrl) }]
    });
  } catch (err) {
    throw mapAnthropicError(err) || err;
  }

  const raw = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = parseJson(raw);

  if (!data) {
    logBadResponse(message, raw);
    const extra = { stopReason: message.stop_reason || null };
    throw message.stop_reason === 'max_tokens' ? TRUNCATED(extra) : BAD_RESPONSE(extra);
  }

  if (!validate(data)) {
    console.error('[generator] JSON reçu mais non conforme au schéma :', JSON.stringify(validate.errors).slice(0, 800));
    throw new AppError(502, 'BAD_AI_RESPONSE', "La réponse de l'IA ne respecte pas le format attendu. Réessaie.", {
      details: validate.errors
    });
  }

  const warnings = enforceNoInventedSkills(data.cv, profile);
  // Atouts et centres d'intérêt : recopiés tels quels depuis le profil (jamais écrits par l'IA, donc rien d'inventé).
  data.cv.strengths = (profile.strengths || []).slice(0, 4);
  data.cv.interests = (profile.interests || []).slice(0, 5);
  return { data, warnings, model };
}

module.exports = { generateApplication };
