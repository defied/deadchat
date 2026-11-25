// Licences of gathered sounds, from freest to least free. "Free" means anyone
// may use, change and sell work that includes it; some still ask for credit.

export type LicenseCode = 'cc0' | 'pdm' | 'by' | 'by-sa' | 'by-nc' | 'by-nc-sa' | 'by-nd' | 'by-nc-nd' | 'pexels' | 'unsplash' | 'unknown';

export interface LicenseInfo {
  code: LicenseCode;
  /** Short name for the UI, e.g. "CC BY 4.0". */
  name: string;
  url: string | null;
  /** Commercial use allowed. */
  commercial: boolean;
  /** Can be trimmed, mixed and changed. */
  derivatives: boolean;
  attribution: boolean;
  /** Lower is freer; used to rank. */
  rank: number;
}

const TABLE: Record<LicenseCode, Omit<LicenseInfo, 'code' | 'url' | 'name'> & { name: string }> = {
  cc0: { name: 'CC0 (public domain)', commercial: true, derivatives: true, attribution: false, rank: 0 },
  pdm: { name: 'Public domain', commercial: true, derivatives: true, attribution: false, rank: 0 },
  by: { name: 'CC BY', commercial: true, derivatives: true, attribution: true, rank: 1 },
  'by-sa': { name: 'CC BY-SA', commercial: true, derivatives: true, attribution: true, rank: 2 },
  'by-nc': { name: 'CC BY-NC', commercial: false, derivatives: true, attribution: true, rank: 3 },
  'by-nc-sa': { name: 'CC BY-NC-SA', commercial: false, derivatives: true, attribution: true, rank: 4 },
  'by-nd': { name: 'CC BY-ND', commercial: true, derivatives: false, attribution: true, rank: 8 },
  'by-nc-nd': { name: 'CC BY-NC-ND', commercial: false, derivatives: false, attribution: true, rank: 9 },
  // Free stock licences: use, change and sell, no credit needed (but welcome).
  pexels: { name: 'Pexels licence', commercial: true, derivatives: true, attribution: false, rank: 1 },
  unsplash: { name: 'Unsplash licence', commercial: true, derivatives: true, attribution: false, rank: 1 },
  unknown: { name: 'Unknown licence', commercial: false, derivatives: false, attribution: true, rank: 10 },
};

/** From a licence URL (Archive.org) or an Openverse code + version. */
export function licenseOf(urlOrCode: string | null | undefined, version?: string | null): LicenseInfo {
  const raw = (urlOrCode ?? '').trim();
  const s = raw.toLowerCase();
  let code: LicenseCode = 'unknown';
  if (/publicdomain\/zero|(^|\b)cc0\b/.test(s)) code = 'cc0';
  else if (/publicdomain\/mark|(^|\b)pdm\b|public ?domain/.test(s)) code = 'pdm';
  else {
    const m = /licenses\/(by(?:-nc)?(?:-sa|-nd)?)\b/.exec(s) ?? /^(by(?:-nc)?(?:-sa|-nd)?)$/.exec(s);
    if (m && m[1] in TABLE) code = m[1] as LicenseCode;
  }
  const v = version ?? /\/(\d\.\d)\/?/.exec(s)?.[1] ?? null;
  const t = TABLE[code];
  const url = /^https?:\/\//.test(raw)
    ? raw.replace(/^http:/, 'https:')
    : code === 'cc0'
      ? 'https://creativecommons.org/publicdomain/zero/1.0/'
      : code === 'pdm'
        ? 'https://creativecommons.org/publicdomain/mark/1.0/'
        : code !== 'unknown'
          ? `https://creativecommons.org/licenses/${code}/${v ?? '4.0'}/`
          : null;
  return { code, name: code.startsWith('by') && v ? `${t.name} ${v}` : t.name, url, commercial: t.commercial, derivatives: t.derivatives, attribution: t.attribution, rank: t.rank };
}

export interface LicensePolicy {
  /** Also offer sounds that can't be used commercially (fine for private pitching). */
  allowNonCommercial?: boolean;
}

/** Sounds we offer: changeable (we trim and mix) and, unless asked, usable commercially. */
export function allowed(l: LicenseInfo, p: LicensePolicy = {}): boolean {
  if (l.code === 'unknown' || !l.derivatives) return false;
  return l.commercial || !!p.allowNonCommercial;
}

/** "“Rain” by Jane Doe (Freesound), CC BY 4.0" — the TASL credit line. */
export function creditLine(c: { title: string; creator?: string | null; sourceName: string; license: LicenseInfo }): string {
  return `“${c.title}”${c.creator ? ` by ${c.creator}` : ''} (${c.sourceName}), ${c.license.name}`;
}

/** The free licences of stock libraries that aren't Creative Commons. */
export function stockLicense(code: 'pexels' | 'unsplash'): LicenseInfo {
  const t = TABLE[code];
  const url = code === 'pexels' ? 'https://www.pexels.com/license/' : 'https://unsplash.com/license';
  return { code, name: t.name, url, commercial: t.commercial, derivatives: t.derivatives, attribution: t.attribution, rank: t.rank };
}
