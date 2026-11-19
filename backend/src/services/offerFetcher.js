'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const cheerio = require('cheerio');

// Sites qui bloquent presque toujours la lecture automatique.
const BLOCKED_HOSTS = ['linkedin.com', 'indeed.com', 'glassdoor.com'];
const ALLOWED_PORTS = new Set(['', '80', '443']);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;

class OfferFetchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 'BLOCKED_SITE' | 'BLOCKED_URL' | 'FETCH_FAILED' | 'TOO_SHORT'
  }
}

// ---------------------------------------------------------------------------
// Protection contre le SSRF : le serveur ne doit jamais aller lire une adresse
// interne (localhost, réseau local, service de métadonnées cloud...) à la demande d'un utilisateur.
// ---------------------------------------------------------------------------
function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // réseau privé
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, métadonnées cloud (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // réseau privé
    (a === 192 && b === 168) || // réseau privé
    (a === 192 && b === 0) || // 192.0.0.0/24 et 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // tests de performance
    a >= 224 // multicast et réservé
  );
}

function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;

  const mappedDotted = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  const mappedHex = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  const first = parseInt(x.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 (adresses locales uniques)
    (first & 0xffc0) === 0xfe80 || // fe80::/10 (link-local)
    (first & 0xff00) === 0xff00 // multicast
  );
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // format inconnu : on refuse
}

async function assertPublicUrl(u) {
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new OfferFetchError('Seuls les liens http(s) sont acceptés.', 'FETCH_FAILED');
  }
  if (u.username || u.password) {
    throw new OfferFetchError("Les liens contenant un identifiant ou un mot de passe ne sont pas acceptés.", 'BLOCKED_URL');
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    throw new OfferFetchError('Ce port n\'est pas autorisé : utilise un lien web classique.', 'BLOCKED_URL');
  }

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    throw new OfferFetchError(
      "Ce site bloque la lecture automatique. Copie le texte de l'offre et colle-le dans le champ prévu.",
      'BLOCKED_SITE'
    );
  }
  if (host === 'localhost' || /\.(localhost|local|internal|lan)$/.test(host)) {
    throw new OfferFetchError("Cette adresse n'est pas autorisée.", 'BLOCKED_URL');
  }

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      throw new OfferFetchError("Impossible de trouver ce site. Vérifie le lien ou colle le texte de l'offre.", 'FETCH_FAILED');
    }
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new OfferFetchError("Cette adresse n'est pas autorisée.", 'BLOCKED_URL');
  }
}

/** Lit la réponse en s'arrêtant au-delà de MAX_BYTES (évite qu'une page géante sature la mémoire). */
async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new OfferFetchError("Cette page est trop volumineuse. Colle le texte de l'offre manuellement.", 'FETCH_FAILED');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchOfferText(url) {
  try {
    let current;
    try {
      current = new URL(url);
    } catch {
      throw new OfferFetchError('Lien invalide.', 'FETCH_FAILED');
    }

    let res = null;
    // Les redirections sont suivies à la main : chaque étape est revérifiée (pas de détour vers une adresse interne).
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current);
      res = await fetch(current, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CVAtsGenerator/0.1)' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000)
      }).catch(() => null);
      if (!res) {
        throw new OfferFetchError("Impossible de lire cette page. Colle le texte de l'offre manuellement.", 'FETCH_FAILED');
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location || hop === MAX_REDIRECTS) {
          throw new OfferFetchError('Trop de redirections. Colle le texte de l\'offre manuellement.', 'FETCH_FAILED');
        }
        try {
          current = new URL(location, current);
        } catch {
          throw new OfferFetchError('Redirection invalide.', 'FETCH_FAILED');
        }
        continue;
      }
      break;
    }

    if (!res.ok) {
      throw new OfferFetchError("Impossible de lire cette page. Colle le texte de l'offre manuellement.", 'FETCH_FAILED');
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw new OfferFetchError("Ce lien ne mène pas à une page web lisible. Colle le texte de l'offre.", 'FETCH_FAILED');
    }

    const html = await readLimited(res);
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, noscript, svg, form, iframe').remove();
    const main = $('main').length ? $('main') : $('body');
    const text = main
      .text()
      .replace(/\s+\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length < 300) {
      throw new OfferFetchError(
        "Le contenu récupéré est trop court (page dynamique ?). Colle le texte de l'offre manuellement.",
        'TOO_SHORT'
      );
    }
    return text.slice(0, 15000);
  } catch (err) {
    if (err instanceof OfferFetchError) throw err;
    throw new OfferFetchError("Impossible de lire cette page. Colle le texte de l'offre manuellement.", 'FETCH_FAILED');
  }
}

module.exports = { fetchOfferText, OfferFetchError, isPrivateIp };
