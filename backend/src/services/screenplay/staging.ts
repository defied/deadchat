// Turns a scene's top-down set plan into words an image model understands:
// who is in frame and where, how big, which way they face, the camera height
// and where each light falls. Pure functions.
//
// Coordinates are metres in screen space (x right, y down). Angles are degrees
// with 0 = +x and 90 = +y, so a positive relative angle is clockwise.

import type { Character, PlanItem, SetPlan } from './types';

const PERSON_HEIGHT = 1.75;

/** Normalise to (-180, 180]. */
export function norm(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

function angleTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Horizontal field of view of a full-frame lens. */
export function fovFor(lensMm: number): number {
  return (2 * Math.atan(18 / Math.max(8, lensMm)) * 180) / Math.PI;
}

/** A sensible lens when the shot says nothing else. */
export function defaultLens(shotType?: string): number {
  const t = (shotType ?? '').toLowerCase();
  if (/extreme close|ecu|macro|insert/.test(t)) return 100;
  if (/close|cu\b|mcu/.test(t)) return 85;
  if (/medium|mid|mcu|cowboy|two[\s-]?shot|over[\s-]the[\s-]shoulder|ots/.test(t)) return 50;
  if (/aerial|drone|establish|extreme wide|ews|wide|ws\b|full|long/.test(t)) return 24;
  return 35;
}

/** Shot size from how much of a standing person the frame holds. */
export function framingFor(distance: number, lensMm: number, aspect = 16 / 9): string {
  const width = 2 * distance * Math.tan(((fovFor(lensMm) / 2) * Math.PI) / 180);
  const height = width / aspect;
  const h = height / PERSON_HEIGHT;
  if (h < 0.2) return 'extreme close-up';
  if (h < 0.4) return 'close-up';
  if (h < 0.6) return 'medium close-up';
  if (h < 0.9) return 'medium shot';
  if (h < 1.25) return 'medium-wide shot';
  if (h < 2.2) return 'full shot';
  if (h < 5) return 'wide shot';
  return 'extreme wide shot';
}

function framePosition(rel: number, halfFov: number): string {
  const x = rel / halfFov;
  if (x < -0.33) return 'frame left';
  if (x > 0.33) return 'frame right';
  return 'centre frame';
}

function facingPhrase(subject: PlanItem, camera: PlanItem): string {
  const toCam = angleTo(subject, camera);
  const diff = Math.abs(norm(toCam - subject.rot));
  // Which way they look on screen: their heading relative to the camera axis.
  const side = norm(subject.rot - camera.rot) < 0 ? 'frame left' : 'frame right';
  if (diff < 30) return 'facing the camera';
  if (diff < 70) return `three-quarter view, turned toward ${side}`;
  if (diff < 110) return `in profile, looking toward ${side}`;
  if (diff < 150) return `three-quarter back view, looking toward ${side}`;
  return 'back to the camera';
}

const HEIGHT_PHRASE: Record<NonNullable<PlanItem['height']>, string> = {
  ground: 'camera at ground level, looking up',
  low: 'low-angle camera looking up',
  eye: 'eye-level camera',
  high: 'high-angle camera looking down',
  overhead: "overhead bird's-eye view looking straight down",
};

const LIGHT_COLOR: Record<NonNullable<PlanItem['color']>, string> = {
  warm: 'warm tungsten',
  neutral: 'neutral white',
  cool: 'cool daylight-blue',
  moonlight: 'pale blue moonlight',
  red: 'red',
  green: 'green',
  blue: 'deep blue',
};

export interface Staging {
  /** One paragraph for the image prompt; '' when the scene has no plan or no camera for the shot. */
  text: string;
  inFrame: string[];
  framing?: string;
  lens?: number;
}

/**
 * Describe what `camera` sees on `plan`. `characters` maps plan character
 * refs to names; `aspect` is the frame's width / height.
 */
export function describeStaging(plan: SetPlan | undefined, camera: PlanItem | undefined, characters: Character[], aspect = 16 / 9, fallbackLens = 35): Staging {
  if (!plan || !camera) return { text: '', inFrame: [] };
  const lens = camera.lens ?? fallbackLens;
  const half = fovFor(lens) / 2;
  const nameOf = (it: PlanItem) =>
    (it.kind === 'character' ? characters.find((c) => c.id === it.ref)?.name : undefined) ?? it.label ?? (it.kind === 'prop' ? 'a prop' : 'a figure');

  const seen = plan.items
    .filter((it) => it.kind === 'character' || it.kind === 'prop')
    .map((it) => {
      const rel = norm(angleTo(camera, it) - camera.rot);
      const d = dist(camera, it);
      // Allow a little margin for a body or object at the edge of frame.
      const margin = (Math.atan(0.35 / Math.max(d, 0.3)) * 180) / Math.PI;
      return { it, rel, d, visible: Math.abs(rel) <= half + margin && d > 0.15 };
    })
    .filter((s) => s.visible)
    .sort((a, b) => a.d - b.d);

  const people = seen.filter((s) => s.it.kind === 'character');
  const props = seen.filter((s) => s.it.kind === 'prop');
  const parts: string[] = [];
  parts.push(`${HEIGHT_PHRASE[camera.height ?? 'eye']}, ${Math.round(lens)}mm lens`);

  let framing: string | undefined;
  if (people.length) {
    const nearest = people[0];
    const farthest = people[people.length - 1];
    framing = framingFor(people.find((p) => p.d >= 1.2)?.d ?? nearest.d, lens, aspect);
    const descs = people.map((p) => {
      const bits = [nameOf(p.it), framePosition(p.rel, half), facingPhrase(p.it, camera)];
      if (people.length > 1 && p === nearest && farthest.d / Math.max(nearest.d, 0.1) > 1.8) {
        bits.push(p.d < 1.4 ? 'in the near foreground, soft focus, over-the-shoulder' : 'in the foreground');
      } else if (people.length > 1 && p === farthest && farthest.d / Math.max(nearest.d, 0.1) > 1.8) {
        bits.push('in the background');
      }
      return bits.join(', ');
    });
    parts.push(`Framing: ${framing}`);
    parts.push(`In frame: ${descs.join('; ')}`);
  } else {
    parts.push('No one in frame');
  }
  if (props.length) {
    parts.push(
      `Set: ${props
        .map((p) => `${nameOf(p.it)} at ${framePosition(p.rel, half)}${p.d > 4 ? ' in the background' : p.d < 1.5 ? ' in the foreground' : ''}`)
        .join('; ')}`,
    );
  }

  // Lights, judged from the main subject (nearest person, else a point 3 m ahead).
  const subject = people[0]?.it ?? {
    x: camera.x + 3 * Math.cos((camera.rot * Math.PI) / 180),
    y: camera.y + 3 * Math.sin((camera.rot * Math.PI) / 180),
  };
  const lights = plan.items.filter((it) => it.kind === 'light');
  const lightParts = lights.map((l) => {
    const color = LIGHT_COLOR[l.color ?? 'neutral'];
    const quality = l.quality === 'hard' ? 'hard' : 'soft';
    const fromSubject = angleTo(subject, l);
    const toCamera = angleTo(subject, camera);
    const diff = Math.abs(norm(fromSubject - toCamera));
    const lateral = norm(angleTo(subject, l) - camera.rot) < 0 ? 'screen left' : 'screen right';
    const relCam = norm(angleTo(camera, l) - camera.rot);
    const visible = Math.abs(relCam) <= half && dist(camera, l) > 0.3;
    let where: string;
    if (diff < 35) where = 'front light from near the camera';
    else if (diff < 100) where = `key light from ${lateral}`;
    else if (diff < 150) where = `edge light from behind, ${lateral}`;
    else where = 'backlight, rim-lighting the subject';
    const practical = l.practical ? `${visible ? 'a practical lamp visible in frame, ' : 'practical lamp, '}` : '';
    return `${practical}${quality} ${color} ${where}`;
  });
  if (lightParts.length) parts.push(`Lighting: ${lightParts.join('; ')}`);

  const cap = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  return { text: `${parts.map(cap).join('. ')}.`, inFrame: people.map((p) => nameOf(p.it)), framing, lens };
}
