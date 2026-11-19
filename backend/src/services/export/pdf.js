'use strict';

const PDFDocument = require('pdfkit');
const { labels, clean, cvSections, contactLine, splitLetter, letterDateLine, senderLines } = require('./shared');

// Police standard du PDF : texte réel, toujours lisible par les ATS (aucune image).
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';

function newDoc(margins, title, author) {
  const doc = new PDFDocument({
    size: 'A4',
    margins,
    bufferPages: true,
    info: { Title: title, Author: author }
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

/** Dessine le CV à une taille donnée ; renvoie le nombre de pages et le PDF final. */
function buildCv(cv, L, size) {
  const margins = { top: 38, bottom: 38, left: 46, right: 46 };
  const h = cv.header || {};
  const { doc, done } = newDoc(margins, `CV - ${clean(h.full_name)}`, clean(h.full_name));

  const left = margins.left;
  const W = doc.page.width - margins.left - margins.right;
  const bottom = doc.page.height - margins.bottom;
  const GAP = 1.5;

  const ensure = (height) => {
    if (doc.y + height > bottom) doc.addPage();
  };

  // En-tête
  doc.font(BOLD).fontSize(size + 8).text(clean(h.full_name), left, doc.y, { width: W, align: 'center' });
  if (clean(h.title)) {
    doc.font(BOLD).fontSize(size + 1).text(clean(h.title), left, doc.y + 1, { width: W, align: 'center' });
  }
  const contact = contactLine(h);
  if (contact) {
    // Réduit légèrement la police pour que les contacts tiennent sur une seule ligne.
    let contactSize = size - 0.5;
    doc.font(FONT).fontSize(contactSize);
    while (doc.widthOfString(contact) > W && contactSize > 7.5) {
      contactSize -= 0.25;
      doc.fontSize(contactSize);
    }
    doc.text(contact, left, doc.y + 2, { width: W, align: 'center' });
  }

  const heading = (title) => {
    ensure(size * 4);
    doc.y += size * 0.7;
    doc.font(BOLD).fontSize(size).text(title, left, doc.y, { width: W, characterSpacing: 0.4 });
    const y = doc.y + 1;
    doc.moveTo(left, y).lineTo(left + W, y).lineWidth(0.6).strokeColor('#444444').stroke();
    doc.y = y + 3;
  };

  const bullet = (text) => {
    const tx = left + 14;
    doc.font(FONT).fontSize(size);
    const hgt = doc.heightOfString(text, { width: W - 14, lineGap: GAP });
    ensure(hgt);
    const y = doc.y;
    doc.text('•', left + 4, y, { lineBreak: false });
    doc.text(text, tx, y, { width: W - 14, lineGap: GAP });
    doc.y += 1;
  };

  for (const s of cvSections(cv, L)) {
    heading(s.title);

    if (s.type === 'text') {
      doc.font(FONT).fontSize(size).text(s.text, left, doc.y, { width: W, lineGap: GAP });
    }

    if (s.type === 'lines') {
      for (const line of s.lines) {
        doc.font(FONT).fontSize(size);
        ensure(doc.heightOfString(line.label + line.text, { width: W, lineGap: GAP }));
        doc.font(BOLD).text(line.label, left, doc.y, { width: W, continued: true, lineGap: GAP });
        doc.font(FONT).text(line.text, { continued: false, lineGap: GAP });
      }
    }

    if (s.type === 'bullets') {
      for (const b of s.items) bullet(b);
    }

    if (s.type === 'entries') {
      for (const e of s.entries) {
        ensure(size * 3.2);
        doc.y += 2;
        doc.font(BOLD).fontSize(size).text(e.heading, left, doc.y, { width: W, lineGap: GAP });
        if (e.sub) doc.font(FONT).fontSize(size - 0.5).fillColor('#333333').text(e.sub, left, doc.y, { width: W, lineGap: GAP }).fillColor('#000000');
        for (const b of e.bullets) bullet(b);
      }
    }
  }

  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { pages, done };
}

// ---------------------------------------------------------------------------
// Modèle « élégant » : police à empattements, titres or/brun avec filet, dates à droite,
// fine ligne verticale décorative. Tout reste du vrai texte sur une colonne (lisible par les ATS) ; pas d'icônes.
// ---------------------------------------------------------------------------
const SERIF = 'Times-Roman';
const SERIF_B = 'Times-Bold';
const SERIF_I = 'Times-Italic';
const GOLD = '#76591C';
const GOLD_LIGHT = '#B89B5E';

function buildCvElegant(cv, L, size) {
  const margins = { top: 38, bottom: 36, left: 50, right: 50 };
  const h = cv.header || {};
  const { doc, done } = newDoc(margins, `CV - ${clean(h.full_name)}`, clean(h.full_name));
  const left = margins.left;
  const W = doc.page.width - margins.left - margins.right;
  const bottom = doc.page.height - margins.bottom;
  const GAP = 1.5;
  const IN = 14; // retrait du contenu des sections à frises
  const ensure = (height) => {
    if (doc.y + height > bottom) doc.addPage();
  };
  const pageNo = () => doc.bufferedPageRange().count - 1;

  // En-tête
  doc.font(SERIF_B).fontSize(size + 15).fillColor(GOLD).text(clean(h.full_name), left, doc.y, { width: W, align: 'center' });
  if (clean(h.title)) {
    doc.font(SERIF_I).fontSize(size + 2).fillColor('#333333').text(clean(h.title), left, doc.y, { width: W, align: 'center' });
  }
  const contact = contactLine(h);
  if (contact) {
    let cs = size - 0.5;
    doc.font(SERIF).fontSize(cs);
    while (doc.widthOfString(contact) > W && cs > 7.5) {
      cs -= 0.25;
      doc.fontSize(cs);
    }
    doc.fillColor('#222222').text(contact, left, doc.y + 3, { width: W, align: 'center' });
  }
  doc.fillColor('#000000');

  const heading = (title) => {
    const hs = size + 1.5;
    ensure(hs * 4);
    doc.y += size * 0.9;
    const y = doc.y;
    doc.font(SERIF_B).fontSize(hs).fillColor(GOLD).text(title, left, y, { lineBreak: false, characterSpacing: 0.6 });
    const tw = doc.widthOfString(title, { characterSpacing: 0.6 });
    const ly = y + hs * 0.55;
    doc.moveTo(left + tw + 10, ly).lineTo(left + W, ly).lineWidth(0.7).strokeColor(GOLD_LIGHT).stroke();
    doc.fillColor('#000000');
    doc.y = y + hs * 1.35;
  };

  const bullet = (text, indent = 0) => {
    const bx = left + indent;
    doc.font(SERIF).fontSize(size);
    const hgt = doc.heightOfString(text, { width: W - indent - 14, lineGap: GAP });
    ensure(hgt);
    const y = doc.y;
    doc.text('•', bx + 4, y, { lineBreak: false });
    doc.text(text, bx + 14, y, { width: W - indent - 14, lineGap: GAP });
    doc.y += 1;
  };

  for (const s of cvSections(cv, L, { splitDates: true })) {
    heading(s.title);

    if (s.type === 'text') {
      doc.font(SERIF).fontSize(size).text(s.text, left, doc.y, { width: W, lineGap: GAP, align: 'justify' });
    }

    if (s.type === 'lines') {
      for (const line of s.lines) {
        doc.font(SERIF).fontSize(size);
        ensure(doc.heightOfString(line.label + line.text, { width: W, lineGap: GAP }));
        doc.font(SERIF_B).text(line.label, left, doc.y, { width: W, continued: true, lineGap: GAP });
        doc.font(SERIF).text(line.text, { continued: false, lineGap: GAP });
      }
    }

    if (s.type === 'bullets') {
      for (const b of s.items) bullet(b, 0);
    }

    if (s.type === 'entries') {
      const x = left + IN;
      const dots = []; // { pg, y } : points de la frise
      for (const e of s.entries) {
        ensure(size * 3.4);
        doc.y += 3;
        const y = doc.y;
        doc.font(SERIF_I).fontSize(size);
        const dw = e.date ? doc.widthOfString(e.date) : 0;
        doc.font(SERIF_B).fontSize(size + 0.5);
        doc.text(e.heading, x, y, { width: W - IN - dw - 10, lineGap: GAP });
        const afterHeading = doc.y;
        if (e.date) {
          doc.font(SERIF_I).fontSize(size).fillColor('#333333').text(e.date, left + W - dw, y, { lineBreak: false });
          doc.fillColor('#000000');
        }
        dots.push({ pg: pageNo(), y: y + (size + 0.5) * 0.55 });
        doc.y = afterHeading;
        if (e.sub) doc.font(SERIF).fontSize(size - 0.3).fillColor('#333333').text(e.sub, x, doc.y, { width: W - IN, lineGap: GAP }).fillColor('#000000');
        for (const b of e.bullets) bullet(b, IN);
      }
      // Frise verticale décorative (vecteur, sans effet sur la lecture du texte)
      const endPg = pageNo();
      const endY = doc.y;
      const pages = [...new Set(dots.map((d) => d.pg))];
      for (const pg of pages) {
        const ys = dots.filter((d) => d.pg === pg).map((d) => d.y);
        const y1 = ys[0];
        const y2 = pg === endPg ? endY - 2 : bottom;
        doc.switchToPage(pg);
        doc.moveTo(left + 3, y1).lineTo(left + 3, y2).lineWidth(0.8).strokeColor(GOLD_LIGHT).stroke();
        for (const y of ys) doc.circle(left + 3, y, 2.3).fillColor(GOLD).fill();
      }
      doc.switchToPage(endPg);
      doc.fillColor('#000000');
      doc.y = endY;
    }
  }

  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { pages, done };
}

/** CV en PDF : réduit la taille du texte (jusqu'à 8,5 pt) pour tenir sur une page. */
async function renderCvPdf(cv, lang, template = 'classic') {
  const L = labels(lang);
  const elegant = template === 'elegant';
  const sizes = elegant ? [11, 10.5, 10, 9.5, 9] : [10.5, 10, 9.5, 9, 8.5];
  for (const size of sizes) {
    const { pages, done } = elegant ? buildCvElegant(cv, L, size) : buildCv(cv, L, size);
    if (pages === 1 || size === sizes[sizes.length - 1]) return done;
    await done; // brouillon trop long : on le jette et on réessaie en plus petit
  }
}

function buildLetter(header, letterText, L, size, elegant = false) {
  const F = elegant ? SERIF : FONT;
  const FB = elegant ? SERIF_B : BOLD;
  const margins = { top: 60, bottom: 56, left: 64, right: 64 };
  const { doc, done } = newDoc(margins, `Lettre de motivation - ${clean(header.full_name)}`, clean(header.full_name));
  const left = margins.left;
  const W = doc.page.width - margins.left - margins.right;
  const { subject, paragraphs } = splitLetter(letterText);

  if (elegant) doc.fillColor(GOLD);
  doc.font(FB).fontSize(size + (elegant ? 4 : 1)).text(clean(header.full_name), left, doc.y, { width: W });
  doc.fillColor('#000000');
  doc.font(F).fontSize(size - 0.5);
  for (const line of senderLines(header)) doc.text(line, left, doc.y, { width: W });

  doc.y += size * 1.4;
  doc.font(F).fontSize(size).text(letterDateLine(header, L), left, doc.y, { width: W, align: 'right' });

  if (subject) {
    doc.y += size * 1.2;
    const text = /^(objet|subject)\s*:/i.test(subject) ? subject : `${L.subject}${L.colon}${subject}`;
    doc.font(FB).fontSize(size).text(text, left, doc.y, { width: W });
  }

  doc.y += size * 0.8;
  doc.font(F).fontSize(size);
  for (const p of paragraphs) {
    doc.text(p, left, doc.y, { width: W, lineGap: 2.5 });
    doc.y += size * 0.8;
  }

  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { pages, done };
}

async function renderLetterPdf({ header, letterText, lang, template }) {
  const L = labels(lang);
  const elegant = template === 'elegant';
  const sizes = elegant ? [12, 11.5, 11, 10.5, 10] : [11, 10.5, 10, 9.5];
  for (const size of sizes) {
    const { pages, done } = buildLetter(header, letterText, L, size, elegant);
    if (pages === 1 || size === sizes[sizes.length - 1]) return done;
    await done;
  }
}

module.exports = { renderCvPdf, renderLetterPdf };
