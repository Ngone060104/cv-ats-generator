'use strict';

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  LevelFormat,
  TabStopType
} = require('docx');
const { labels, clean, cvSections, contactLine, splitLetter, letterDateLine, senderLines } = require('./shared');

const FONT = 'Calibri';
const BODY = 21; // 10,5 pt (en demi-points)

const run = (text, o = {}) =>
  new TextRun({ text, font: o.font || FONT, size: o.size || BODY, bold: o.bold, italics: o.italics, color: o.color });

/** Texte multi-lignes : chaque \n devient un saut de ligne dans le même paragraphe. */
const multiline = (text, o = {}) =>
  String(text)
    .split('\n')
    .map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0, font: FONT, size: o.size || BODY, bold: o.bold }));

const PAGE = {
  size: { width: 11906, height: 16838 }, // A4
  margin: { top: 700, bottom: 700, left: 900, right: 900 }
};

const NUMBERING = {
  config: [
    {
      reference: 'bullets',
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 260 } } }
        }
      ]
    }
  ]
};

const baseDoc = (title, author, children, margin = PAGE.margin) =>
  new Document({
    creator: author,
    title,
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    numbering: NUMBERING,
    sections: [{ properties: { page: { size: PAGE.size, margin } }, children }]
  });

const GOLD = '76591C';
const GOLD_LIGHT = 'B89B5E';
const SERIF = 'Times New Roman';
const CONTENT_WIDTH = 11906 - 900 - 900;

/** Modèle « élégant » en Word : police à empattements, titres or/brun, dates alignées à droite par tabulation. */
async function renderCvDocxElegant(cv, lang) {
  const L = labels(lang);
  const h = cv.header || {};
  const r = (text, o = {}) => run(text, { font: SERIF, ...o });
  const children = [];

  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, children: [r(clean(h.full_name), { size: 44, bold: true, color: GOLD })] })
  );
  if (clean(h.title)) {
    children.push(
      new Paragraph({ alignment: AlignmentType.CENTER, children: [r(clean(h.title), { size: 24, italics: true, color: '333333' })] })
    );
  }
  const contact = contactLine(h);
  if (contact) {
    children.push(
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [r(contact, { size: 20 })] })
    );
  }

  for (const s of cvSections(cv, L, { splitDates: true })) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD_LIGHT, space: 1 } },
        children: [r(s.title, { bold: true, size: 24, color: GOLD })]
      })
    );

    if (s.type === 'text') {
      children.push(
        new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 40 }, children: [r(s.text, { size: 22 })] })
      );
    }
    if (s.type === 'lines') {
      for (const line of s.lines) {
        children.push(
          new Paragraph({ spacing: { after: 20 }, children: [r(line.label, { bold: true, size: 22 }), r(line.text, { size: 22 })] })
        );
      }
    }
    if (s.type === 'bullets') {
      for (const b of s.items) {
        children.push(
          new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 20 }, children: [r(b, { size: 22 })] })
        );
      }
    }
    if (s.type === 'entries') {
      for (const e of s.entries) {
        const headRuns = [r(e.heading, { bold: true, size: 22 })];
        if (e.date) headRuns.push(new TextRun({ text: '\t', font: SERIF }), r(e.date, { italics: true, size: 21, color: '333333' }));
        children.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: 90 },
            tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
            children: headRuns
          })
        );
        if (e.sub) {
          children.push(
            new Paragraph({ keepNext: e.bullets.length > 0, children: [r(e.sub, { size: 21, color: '333333' })] })
          );
        }
        for (const b of e.bullets) {
          children.push(
            new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 20 }, children: [r(b, { size: 22 })] })
          );
        }
      }
    }
  }

  const doc = baseDoc(`CV - ${clean(h.full_name)}`, clean(h.full_name), children);
  return Packer.toBuffer(doc);
}

async function renderCvDocx(cv, lang, template = 'classic') {
  if (template === 'elegant') return renderCvDocxElegant(cv, lang);
  const L = labels(lang);
  const h = cv.header || {};
  const children = [];

  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, children: [run(clean(h.full_name), { size: 36, bold: true })] })
  );
  if (clean(h.title)) {
    children.push(
      new Paragraph({ alignment: AlignmentType.CENTER, children: [run(clean(h.title), { size: 24, bold: true })] })
    );
  }
  const contact = contactLine(h);
  if (contact) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [run(contact, { size: 19 })]
      })
    );
  }

  for (const s of cvSections(cv, L)) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '444444', space: 1 } },
        children: [run(s.title, { bold: true, size: 22 })]
      })
    );

    if (s.type === 'text') {
      children.push(new Paragraph({ spacing: { after: 40 }, children: [run(s.text)] }));
    }

    if (s.type === 'lines') {
      for (const line of s.lines) {
        children.push(
          new Paragraph({ spacing: { after: 20 }, children: [run(line.label, { bold: true }), run(line.text)] })
        );
      }
    }

    if (s.type === 'bullets') {
      for (const b of s.items) {
        children.push(
          new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 20 }, children: [run(b)] })
        );
      }
    }

    if (s.type === 'entries') {
      for (const e of s.entries) {
        children.push(
          new Paragraph({ keepNext: true, spacing: { before: 80 }, children: [run(e.heading, { bold: true })] })
        );
        if (e.sub) {
          children.push(
            new Paragraph({ keepNext: e.bullets.length > 0, children: [run(e.sub, { size: 20, color: '333333' })] })
          );
        }
        for (const b of e.bullets) {
          children.push(
            new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 20 }, children: [run(b)] })
          );
        }
      }
    }
  }

  const doc = baseDoc(`CV - ${clean(h.full_name)}`, clean(h.full_name), children);
  return Packer.toBuffer(doc);
}

async function renderLetterDocx({ header, letterText, lang, template }) {
  const elegant = template === 'elegant';
  const L = labels(lang);
  const { subject, paragraphs } = splitLetter(letterText);
  const children = [];

  children.push(
    new Paragraph({
      children: [
        elegant
          ? run(clean(header.full_name), { bold: true, size: 32, color: GOLD, font: SERIF })
          : run(clean(header.full_name), { bold: true, size: 24 })
      ]
    })
  );
  for (const line of senderLines(header)) {
    children.push(new Paragraph({ children: [run(line, { size: 20 })] }));
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 300, after: 200 },
      children: [run(letterDateLine(header, L), { size: 22 })]
    })
  );

  if (subject) {
    const text = /^(objet|subject)\s*:/i.test(subject) ? subject : `${L.subject}${L.colon}${subject}`;
    children.push(new Paragraph({ spacing: { after: 200 }, children: [run(text, { bold: true, size: 22 })] }));
  }

  for (const p of paragraphs) {
    children.push(new Paragraph({ spacing: { after: 160, line: 300 }, children: multiline(p, { size: 22 }) }));
  }

  const doc = baseDoc(`Lettre de motivation - ${clean(header.full_name)}`, clean(header.full_name), children, {
    top: 1100,
    bottom: 1000,
    left: 1200,
    right: 1200
  });
  return Packer.toBuffer(doc);
}

module.exports = { renderCvDocx, renderLetterDocx };
