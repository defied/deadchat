// GET /api/public/media/:id/:exp/:variant/:sig — unauthenticated, signed and
// expiring. Lets Instagram and Threads download a post's media. Converted
// images carry the IPTC AI source type so the platforms label them as AI.

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { getMedia, getMediaPath } from '../services/mediaStore';
import { verifyMediaSignature, type MediaVariant } from '../services/influencers/publicMedia';

const router = Router();

/** Instagram feed posts must be between 4:5 (portrait) and 1.91:1 (landscape). */
export function instagramCrop(width: number, height: number): { width: number; height: number } | null {
  const ratio = width / height;
  if (ratio < 0.8) return { width, height: Math.round(width / 0.8) };
  if (ratio > 1.91) return { width: Math.round(height * 1.91), height };
  return null;
}

/**
 * IPTC "trainedAlgorithmicMedia" digital source type, the tag Meta and other
 * platforms read to label an image as AI-generated.
 */
export const AI_SOURCE_TYPE = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
export const AI_XMP = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    Iptc4xmpExt:DigitalSourceType="${AI_SOURCE_TYPE}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

async function convert(file: string, variant: MediaVariant): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  let img = sharp(file).rotate();
  if (variant === 'ig') {
    const meta = await img.metadata();
    const crop = meta.width && meta.height ? instagramCrop(meta.width, meta.height) : null;
    // sharp applies only the last resize(), so crop and cap the width in one call.
    if (crop) {
      const width = Math.min(crop.width, 1440);
      const height = Math.round((crop.height * width) / crop.width);
      img = img.resize({ width, height, fit: 'cover', position: sharp.strategy.attention });
    } else {
      img = img.resize({ width: 1440, withoutEnlargement: true });
    }
  }
  return img.flatten({ background: '#ffffff' }).withXmp(AI_XMP).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

router.get('/:id/:exp/:variant/:sig', async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const exp = Number(req.params.exp);
  const variant = String(req.params.variant) as MediaVariant;
  if (!verifyMediaSignature(id, exp, variant, String(req.params.sig))) {
    res.status(403).json({ error: 'Link invalid or expired' });
    return;
  }
  const media = getMedia(id);
  const file = media ? getMediaPath(media.filename) : '';
  if (!media || !fs.existsSync(file)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (variant !== 'orig' && media.type === 'image') {
    try {
      const out = await convert(file, variant);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', out.length);
      res.end(out);
    } catch (e) {
      res.status(500).json({ error: `Could not convert image: ${(e as Error).message}` });
    }
    return;
  }

  const total = fs.statSync(file).size;
  res.setHeader('Content-Type', media.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start > end || start >= total) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', total);
  fs.createReadStream(file).pipe(res);
});

export default router;
