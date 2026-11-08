// Screenplay element rules (Final Draft conventions), Fountain and Final Draft
// (.fdx) import/export, page estimates and print layout.

import type { ElementType, ScreenplayDoc, ScriptElement, TitlePage } from '../../api/screenplays';

export const ELEMENTS: Array<{ type: ElementType; label: string; key: string }> = [
  { type: 'scene', label: 'Scene Heading', key: '1' },
  { type: 'action', label: 'Action', key: '2' },
  { type: 'character', label: 'Character', key: '3' },
  { type: 'parenthetical', label: 'Parenthetical', key: '4' },
  { type: 'dialogue', label: 'Dialogue', key: '5' },
  { type: 'transition', label: 'Transition', key: '6' },
  { type: 'shot', label: 'Shot', key: '7' },
  { type: 'general', label: 'General', key: '0' },
  { type: 'centered', label: 'Centered', key: '8' },
];

export const LABEL: Record<ElementType, string> = Object.fromEntries(ELEMENTS.map((e) => [e.type, e.label])) as Record<ElementType, string>;

/** Elements typed in capitals. */
export const UPPER = new Set<ElementType>(['scene', 'character', 'transition', 'shot']);

/** What Enter creates after each element. */
export const ENTER_NEXT: Record<ElementType, ElementType> = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'action',
  transition: 'scene',
  shot: 'action',
  general: 'general',
  centered: 'action',
};

/** Tab / Shift-Tab change the current element's type (Final Draft style). */
export const TAB_NEXT: Record<ElementType, ElementType> = {
  action: 'character',
  character: 'transition',
  transition: 'scene',
  scene: 'action',
  dialogue: 'parenthetical',
  parenthetical: 'dialogue',
  shot: 'action',
  general: 'action',
  centered: 'action',
};
export const TAB_PREV: Record<ElementType, ElementType> = {
  action: 'scene',
  scene: 'transition',
  transition: 'character',
  character: 'action',
  dialogue: 'character',
  parenthetical: 'dialogue',
  shot: 'action',
  general: 'action',
  centered: 'action',
};

export const SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EXT./INT. ', 'I/E. ', 'EST. '];
export const TIMES_OF_DAY = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME'];
export const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE OUT.', 'FADE TO BLACK.', 'FADE IN:', 'CUT TO BLACK.', 'INTERCUT WITH:'];
export const EXTENSIONS = ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)", '(PRE-LAP)', '(ON PHONE)'];
export const SHOT_TYPES = [
  'Establishing',
  'Extreme wide',
  'Wide',
  'Full',
  'Medium wide',
  'Medium',
  'Medium close-up',
  'Close-up',
  'Extreme close-up',
  'Over-the-shoulder',
  'Two-shot',
  'POV',
  'Insert',
  'Low angle',
  'High angle',
  "Bird's-eye",
  'Dutch angle',
  'Aerial',
  'Tracking',
  'Crane',
  'Handheld',
];

/** A sensible lens when nothing else says (mirrors the server's default). */
export function defaultLens(shotType?: string): number {
  const t = (shotType ?? '').toLowerCase();
  if (/extreme close|ecu|macro|insert/.test(t)) return 100;
  if (/close|cu\b|mcu/.test(t)) return 85;
  if (/medium|mid|mcu|cowboy|two[\s-]?shot|over[\s-]the[\s-]shoulder|ots/.test(t)) return 50;
  if (/aerial|drone|establish|extreme wide|ews|wide|ws\b|full|long/.test(t)) return 24;
  return 35;
}

export function newId(prefix = 'e'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Character cue without extensions: "JANE (V.O.)" → "JANE". */
export function cueName(text: string): string {
  return text.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim();
}

// ── pages ────────────────────────────────────────────────────────────────────

const WIDTH: Record<ElementType, number> = {
  scene: 60, action: 60, character: 38, parenthetical: 25, dialogue: 35, transition: 60, shot: 60, general: 60, centered: 60,
};
const BEFORE: Record<ElementType, number> = {
  scene: 2, action: 1, character: 1, parenthetical: 0, dialogue: 0, transition: 1, shot: 1, general: 1, centered: 1,
};
export const LINES_PER_PAGE = 55;

function wrappedLines(text: string, width: number): number {
  let n = 0;
  for (const para of (text || ' ').split('\n')) {
    let line = 0;
    n++;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line + 1 + word.length > width) {
        n++;
        line = word.length;
      } else line += (line ? 1 : 0) + word.length;
    }
  }
  return n;
}

/** Page number each element starts on (1-based), estimated with standard margins. */
export function pageStarts(elements: ScriptElement[]): number[] {
  const pages: number[] = [];
  let page = 1;
  let line = 0;
  elements.forEach((e, i) => {
    const before = i === 0 ? 0 : BEFORE[e.type];
    const len = wrappedLines(e.text, WIDTH[e.type]);
    if (line && line + before + len > LINES_PER_PAGE) {
      page++;
      line = 0;
    } else line += before;
    pages.push(page);
    line += len;
  });
  return pages;
}

export function sceneNumbers(elements: ScriptElement[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const e of elements) if (e.type === 'scene') out.set(e.id, ++n);
  return out;
}

// ── Fountain ─────────────────────────────────────────────────────────────────

const SCENE_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;

export function parseFountain(src: string): { elements: ScriptElement[]; titlePage: TitlePage } {
  const text = src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '') // boneyard
    .replace(/\[\[[\s\S]*?\]\]/g, ''); // notes
  let lines = text.split('\n');
  const titlePage: TitlePage = {};

  // Title page: "Key: value" lines before the first blank line.
  if (/^(Title|Credit|Author|Authors|Source|Draft date|Contact)\s*:/i.test(lines[0] ?? '')) {
    let i = 0;
    let key = '';
    const map: Record<string, string> = {};
    for (; i < lines.length && lines[i].trim() !== ''; i++) {
      const m = /^([A-Za-z ]+):\s*(.*)$/.exec(lines[i]);
      if (m) {
        key = m[1].toLowerCase();
        map[key] = m[2].trim();
      } else if (key) map[key] = `${map[key] ? `${map[key]}\n` : ''}${lines[i].trim()}`;
    }
    titlePage.title = map.title;
    titlePage.credit = map.credit;
    titlePage.author = map.author ?? map.authors;
    titlePage.source = map.source;
    titlePage.contact = map.contact;
    titlePage.draftDate = map['draft date'];
    lines = lines.slice(i + 1);
  }

  const out: ScriptElement[] = [];
  const push = (type: ElementType, t: string) => out.push({ id: newId(), type, text: t });
  const blank = (i: number) => i < 0 || i >= lines.length || lines[i].trim() === '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (/^(#|=(?!=)|===)/.test(line)) continue; // sections, synopses, page breaks
    if (line.startsWith('!')) {
      push('action', line.slice(1));
      continue;
    }
    if (/^>.*<$/.test(line)) {
      push('centered', line.slice(1, -1).trim());
      continue;
    }
    if ((line.startsWith('.') && !line.startsWith('..')) || (blank(i - 1) && SCENE_RE.test(line))) {
      push('scene', (line.startsWith('.') ? line.slice(1) : line).replace(/\s+#[^#]+#$/, '').toUpperCase());
      continue;
    }
    if (line.startsWith('>') || (blank(i - 1) && blank(i + 1) && line === line.toUpperCase() && /TO:$/.test(line))) {
      push('transition', line.replace(/^>\s*/, '').toUpperCase());
      continue;
    }
    const forcedChar = line.startsWith('@');
    const isCue =
      forcedChar ||
      (blank(i - 1) && !blank(i + 1) && /[A-Z]/.test(cueName(line)) && cueName(line) === cueName(line).toUpperCase() && !/[.!?:]$/.test(cueName(line)));
    if (isCue) {
      push('character', (forcedChar ? line.slice(1) : line).replace(/\s*\^$/, '').trim());
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== ''; j++) {
        const l = lines[j].trim();
        if (l.startsWith('(') && l.endsWith(')')) push('parenthetical', l);
        else if (out[out.length - 1].type === 'dialogue') out[out.length - 1].text += `\n${l}`;
        else push('dialogue', l);
      }
      i = j - 1;
      continue;
    }
    // Action: keep consecutive lines together as one paragraph.
    let para = raw.replace(/^\s+/, '');
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') para += `\n${lines[++i]}`;
    push('action', para);
  }
  return { elements: out.length ? out : [{ id: newId(), type: 'scene', text: '' }], titlePage };
}

export function toFountain(doc: ScreenplayDoc, title: string): string {
  const tp = doc.titlePage ?? {};
  const head = [
    `Title: ${tp.title || title}`,
    tp.credit && `Credit: ${tp.credit}`,
    tp.author && `Author: ${tp.author}`,
    tp.source && `Source: ${tp.source}`,
    tp.draftDate && `Draft date: ${tp.draftDate}`,
    tp.contact && `Contact: ${tp.contact.replace(/\n/g, '\n    ')}`,
  ].filter(Boolean);
  const body: string[] = [];
  doc.elements.forEach((e, i) => {
    const t = e.text;
    const prev = doc.elements[i - 1];
    const gap = !(e.type === 'dialogue' || e.type === 'parenthetical') || !prev;
    if (gap && body.length) body.push('');
    switch (e.type) {
      case 'scene':
        body.push(SCENE_RE.test(t) ? t.toUpperCase() : `.${t.toUpperCase()}`);
        break;
      case 'character':
        body.push(t === t.toUpperCase() && /[A-Z]/.test(t) ? t : `@${t}`);
        break;
      case 'transition':
        body.push(/TO:$/.test(t.toUpperCase()) ? t.toUpperCase() : `> ${t.toUpperCase()}`);
        break;
      case 'centered':
        body.push(`> ${t} <`);
        break;
      case 'parenthetical':
        body.push(t.startsWith('(') ? t : `(${t})`);
        break;
      case 'shot':
        body.push(t.toUpperCase());
        break;
      case 'action':
      case 'general': {
        const first = t.split('\n')[0] ?? '';
        const looksSpecial = SCENE_RE.test(first) || (first === first.toUpperCase() && /[A-Z]/.test(first));
        body.push(looksSpecial ? `!${t}` : t);
        break;
      }
      default:
        body.push(t);
    }
  });
  return `${head.join('\n')}\n\n${body.join('\n')}\n`;
}

// ── Final Draft (.fdx) ───────────────────────────────────────────────────────

const FDX_TYPE: Record<ElementType, string> = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
  centered: 'Action',
};

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toFdx(doc: ScreenplayDoc, title: string): string {
  const paras = doc.elements
    .map((e) => {
      const align = e.type === 'centered' ? ' Alignment="Center"' : '';
      return `    <Paragraph Type="${FDX_TYPE[e.type]}"${align}>\n      <Text>${xml(e.text)}</Text>\n    </Paragraph>`;
    })
    .join('\n');
  const tp = doc.titlePage ?? {};
  const tpLine = (t: string | undefined, align = 'Center') =>
    t ? `      <Paragraph Alignment="${align}" Type="General"><Text>${xml(t)}</Text></Paragraph>` : '';
  const titlePage = [tpLine((tp.title || title).toUpperCase()), tpLine(tp.credit), tpLine(tp.author), tpLine(tp.source), tpLine(tp.draftDate, 'Left'), tpLine(tp.contact, 'Left')]
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras}
  </Content>
  <TitlePage>
    <Content>
${titlePage}
    </Content>
  </TitlePage>
</FinalDraft>
`;
}

const FROM_FDX: Record<string, ElementType> = {
  'Scene Heading': 'scene',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'parenthetical',
  Dialogue: 'dialogue',
  Transition: 'transition',
  Shot: 'shot',
  General: 'general',
  'Cast List': 'general',
  'New Act': 'centered',
  'End of Act': 'centered',
};

export function parseFdx(src: string): { elements: ScriptElement[]; titlePage: TitlePage } {
  const dom = new DOMParser().parseFromString(src, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('That isn’t a valid Final Draft file');
  const content = dom.querySelector('FinalDraft > Content');
  const elements: ScriptElement[] = [];
  content?.querySelectorAll(':scope > Paragraph').forEach((p) => {
    const type = FROM_FDX[p.getAttribute('Type') ?? ''] ?? 'action';
    const text = [...p.querySelectorAll('Text')].map((t) => t.textContent ?? '').join('');
    elements.push({ id: newId(), type: p.getAttribute('Alignment') === 'Center' && type === 'action' ? 'centered' : type, text });
  });
  const tpTexts = [...dom.querySelectorAll('TitlePage Paragraph')].map((p) => [...p.querySelectorAll('Text')].map((t) => t.textContent ?? '').join('').trim()).filter(Boolean);
  return {
    elements: elements.length ? elements : [{ id: newId(), type: 'scene', text: '' }],
    titlePage: { title: tpTexts[0] },
  };
}

// ── print / PDF ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/** A standalone, print-ready HTML document (US Letter, industry margins). */
export function printHtml(doc: ScreenplayDoc, title: string): string {
  const tp = doc.titlePage ?? {};
  const scenes = sceneNumbers(doc.elements);
  const body = doc.elements
    .map((e) => {
      const n = scenes.get(e.id);
      const num = n ? `<span class="num l">${n}</span><span class="num r">${n}</span>` : '';
      return `<p class="${e.type}">${num}${esc(e.type === 'parenthetical' && !e.text.startsWith('(') ? `(${e.text})` : e.text)}</p>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(tp.title || title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap">
<style>
@page { size: 8.5in 11in; margin: 1in 0.5in 1in 0.75in; }
/* Side margins live in body padding so scene numbers in the margin still print. */
body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1; color: #000; margin: 0; padding: 0 0.5in 0 0.75in; }
p { margin: 0; white-space: pre-wrap; position: relative; }
.title-page { height: 9in; display: flex; flex-direction: column; page-break-after: always; }
.title-page .t { margin-top: 3in; text-align: center; text-transform: uppercase; }
.title-page .c { text-align: center; margin-top: 1em; }
.title-page .meta { margin-top: auto; white-space: pre-wrap; }
.scene { margin-top: 2em; text-transform: uppercase; font-weight: 700; }
.action, .general, .shot { margin-top: 1em; }
.shot { text-transform: uppercase; }
.character { margin-top: 1em; margin-left: 2.2in; text-transform: uppercase; }
.parenthetical { margin-left: 1.6in; width: 2in; }
.dialogue { margin-left: 1in; width: 3.5in; }
.transition { margin-top: 1em; text-align: right; text-transform: uppercase; }
.centered { margin-top: 1em; text-align: center; }
.character, .parenthetical { page-break-after: avoid; }
.scene, .shot { page-break-after: avoid; }
.num { position: absolute; top: 0; font-weight: 700; }
.num.l { left: -0.6in; } .num.r { right: -0.45in; }
body > p:first-of-type { margin-top: 0; }
</style></head><body>
<div class="title-page"><div class="t">${esc(tp.title || title)}</div>
<div class="c">${esc(tp.credit || 'Written by')}</div><div class="c">${esc(tp.author || '')}</div>
${tp.source ? `<div class="c">${esc(tp.source)}</div>` : ''}
<div class="meta">${esc([tp.draftDate, tp.contact].filter(Boolean).join('\n\n'))}</div></div>
${body}
<script>document.fonts.ready.then(() => setTimeout(() => window.print(), 200));</script>
</body></html>`;
}

export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Running time code for shot start offsets: 75 → "01:15". */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
}
