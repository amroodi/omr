/**
 * Identifies this browser to the server («امنیت ورود»): a websites can't read a MAC address, so we send
 *  - `x-device-id`: a random id kept in this browser (localStorage + cookie) — the same until the
 *    browser's data is cleared;
 *  - `x-device-fp`: a hash of the browser's traits (system, screen, time zone, language, graphics…),
 *    which stays the same even after clearing the browser.
 * Both are only used to recognise devices in the Super Admin's sign-in records and alerts.
 */
const KEY = 'omr_device';
let deviceId: string | null = null;
let fingerprint: string | null = null;

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([A-Za-z0-9-]+)`));
  return m ? m[1] : null;
}

export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  if (deviceId) return deviceId;
  try {
    let id = localStorage.getItem(KEY) || readCookie(KEY);
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    document.cookie = `${KEY}=${id}; path=/; max-age=${5 * 365 * 86400}; SameSite=Lax`;
    deviceId = id;
  } catch {
    deviceId = deviceId ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null);
  }
  return deviceId;
}

export function getFingerprint(): string | null {
  return fingerprint;
}

function canvasTrait(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 220; c.height = 30;
    const g = c.getContext('2d');
    if (!g) return '';
    g.textBaseline = 'top'; g.font = '14px Arial'; g.fillStyle = '#f60'; g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069'; g.fillText('omr-damuon ✓ بیمه', 2, 15);
    return c.toDataURL();
  } catch { return ''; }
}

function webglTrait(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

async function computeFingerprint(): Promise<void> {
  if (typeof window === 'undefined' || !crypto?.subtle) return;
  const n = navigator as Navigator & { deviceMemory?: number };
  const traits = [
    n.userAgent, n.platform, n.language, (n.languages || []).join(','), Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}x${screen.colorDepth}`, window.devicePixelRatio, n.hardwareConcurrency, n.deviceMemory ?? '', n.maxTouchPoints,
    canvasTrait(), webglTrait(),
  ].join('||');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
  fingerprint = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Start as soon as the app loads, so the very first sign-in already carries both. */
export const deviceReady: Promise<void> = typeof window === 'undefined' ? Promise.resolve() : (getDeviceId(), computeFingerprint().catch(() => {}));
