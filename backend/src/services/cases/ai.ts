// AI notes for case evidence and an AI draft of the case summary. Both use
// the local Ollama model, so nothing leaves the network, and both are
// labelled as AI drafts for the physician to check and edit.

import fs from 'fs';
import sharp from 'sharp';
import { localChat } from '../media/enhance';
import * as store from './store';
import type { CaseItem, CaseProfile, MedicalCase } from './store';

const SAMPLE_FRAMES = 4;

export function oneLiner(p: CaseProfile): string {
  const who = [p.age, p.sex].filter(Boolean).join(' ');
  const dx = p.diagnoses?.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join('; ');
  return [who && `${who} patient`, p.chiefComplaint && `presenting with ${p.chiefComplaint}`, dx && `known: ${dx}`].filter(Boolean).join(', ');
}

function metaLine(item: CaseItem): string {
  const d = item.meta.dicom;
  const bits = [
    d?.modality && `modality ${d.modality}`,
    d?.studyDescription,
    d?.seriesDescription,
    d?.bodyPart,
    d?.viewPosition,
    item.frames > 1 ? `${item.frames} ${d && ['CT', 'MR', 'PT', 'NM'].includes(d.modality ?? '') && item.series_uid ? 'slices' : 'frames'}` : '',
    item.meta.fps && item.frames > 1 ? `${item.meta.fps} fps` : '',
    d?.heartRate ? `heart rate ${d.heartRate}` : '',
    item.taken_at && `dated ${item.taken_at}`,
  ].filter(Boolean);
  return bits.join(', ');
}

async function small(file: string): Promise<string> {
  const b = await sharp(file).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return b.toString('base64');
}

/** The images to show the model for an item, if any. */
async function imagesFor(item: CaseItem): Promise<string[]> {
  const frames = item.meta.frameFiles ?? [];
  if (frames.length) {
    const n = Math.min(SAMPLE_FRAMES, frames.length);
    const picks = n === 1 ? [0] : Array.from({ length: n }, (_, i) => Math.round((i * (frames.length - 1)) / (n - 1)));
    return Promise.all(picks.map((i) => small(store.itemPath(item, frames[i].file))));
  }
  if (item.kind === 'image' && item.meta.display) return [await small(store.itemPath(item, item.meta.display))];
  if (item.meta.hasThumb) return [await small(store.itemPath(item, 'thumb.jpg'))];
  return [];
}

const DESCRIBE_SYSTEM =
  'You help a physician prepare a case presentation for colleagues. Describe the attached medical evidence ' +
  'objectively: what it is (modality, view or plane, phase), technical quality, and the findings you can see. ' +
  'When several frames from one loop or stack are attached, say what changes across them (motion, contractility, ' +
  'flow, level). Use cautious language and say when something is uncertain or not assessable. Do not give a ' +
  'final diagnosis or treatment advice, and never guess who the patient is. 100-200 words, plain text.';

/** Write AI notes for one item. Runs in the background; status is on the item. */
export async function describeItem(item: CaseItem, c: MedicalCase): Promise<void> {
  store.updateItem(item.id, { ai_status: 'running', ai_error: null });
  try {
    const images = await imagesFor(item);
    let text = '';
    const context = [
      `Case: ${oneLiner(c.profile) || 'no profile given'}.`,
      c.profile.question ? `Clinical question: ${c.profile.question}` : '',
      `Evidence: "${item.title}" (${item.category}${metaLine(item) ? `; ${metaLine(item)}` : ''}).`,
      item.notes ? `Physician's notes on it: ${item.notes}` : '',
    ].filter(Boolean);
    if (images.length) {
      text = (await localChat(DESCRIBE_SYSTEM, `${context.join('\n')}\n${images.length > 1 ? `${images.length} frames attached in order.` : 'Image attached.'}`, images)).text;
    } else if (item.meta.table) {
      const t = item.meta.table;
      const csv = [t.columns.join(', '), ...t.rows.slice(0, 60).map((r) => r.join(', '))].join('\n');
      text = (
        await localChat(
          'You help a physician prepare a case presentation. Summarise this table of results: what was measured, ' +
            'notable abnormal values and trends over time, with units. Only use the data given. 80-160 words, plain text.',
          `${context.join('\n')}\nData (first rows):\n${csv}`,
        )
      ).text;
    } else if (item.kind === 'document' && item.meta.displayMime === 'text/plain' && item.meta.display) {
      const body = fs.readFileSync(store.itemPath(item, item.meta.display), 'utf8').slice(0, 12000);
      text = (
        await localChat(
          'You help a physician prepare a case presentation. Summarise this document’s clinically relevant content ' +
            'in 80-160 words. Only use what it says.',
          `${context.join('\n')}\nDocument:\n${body}`,
        )
      ).text;
    } else {
      throw new Error('AI notes need an image, video poster, cine/stack frames, a table or a text document');
    }
    if (!text) throw new Error('The model returned nothing');
    store.updateItem(item.id, { ai_notes: text, ai_status: 'done', ai_error: null });
  } catch (e) {
    store.updateItem(item.id, { ai_status: 'failed', ai_error: (e as Error).message });
  }
}

function profileText(p: CaseProfile): string {
  const lines: string[] = [];
  const add = (label: string, v?: string | number) => {
    if (v !== undefined && v !== null && String(v).trim()) lines.push(`${label}: ${String(v).trim()}`);
  };
  add('Age', p.age);
  add('Sex', p.sex);
  add('Weight (kg)', p.weightKg);
  add('Height (cm)', p.heightCm);
  add('Specialty', p.specialty);
  add('Chief complaint', p.chiefComplaint);
  add('History of present illness', p.hpi);
  add('Past history', p.pmh);
  add('Diagnoses', p.diagnoses);
  add('Procedures', p.procedures);
  add('Medications', p.medications);
  add('Allergies', p.allergies);
  add('Family history', p.familyHistory);
  add('Social history', p.socialHistory);
  add('Examination', p.exam);
  if (p.vitals) add('Vitals', Object.entries(p.vitals).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', '));
  add('Clinical question', p.question);
  add('Teaching points', p.teachingPoints);
  if (p.labs?.length) add('Labs', p.labs.map((l) => `${l.date ?? ''} ${l.test} ${l.value}${l.unit ? ` ${l.unit}` : ''}${l.low || l.high ? ` (ref ${l.low ?? ''}-${l.high ?? ''})` : ''}`.trim()).join('; '));
  if (p.events?.length) add('Timeline', p.events.map((e) => `${e.date ?? 'undated'}: ${e.title}${e.detail ? ` (${e.detail})` : ''}`).join('; '));
  return lines.join('\n');
}

/** An AI draft of the case summary for presenting, from everything in the case. */
export async function summarizeCase(c: MedicalCase, items: CaseItem[]): Promise<string> {
  const evidence = items
    .filter((i) => i.include)
    .map((i) => `- [${i.category}] ${i.title}${i.taken_at ? ` (${i.taken_at})` : ''}${metaLine(i) ? `; ${metaLine(i)}` : ''}${i.notes ? `\n  Physician notes: ${i.notes}` : ''}${i.ai_notes ? `\n  AI notes: ${i.ai_notes}` : ''}`)
    .join('\n');
  const { text } = await localChat(
    'You help a physician present a case to colleagues. From the case profile and evidence list, write a concise ' +
      'presentation summary in Markdown with these sections: **One-liner**, **Presentation**, **Key findings** ' +
      '(grouped by imaging, cine/echo, ECG, labs, reports as available, citing evidence titles), **Timeline**, and ' +
      '**Open questions / gaps** (missing data that would help). Use only the information given; do not invent ' +
      'findings, values or diagnoses. Keep it under 350 words.',
    `Case: ${c.title}\n\nProfile:\n${profileText(c.profile) || '(none)'}\n\nEvidence:\n${evidence || '(none)'}`,
  );
  if (!text) throw new Error('The model returned nothing');
  return text;
}
