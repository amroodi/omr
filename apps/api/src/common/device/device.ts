import { Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { isIP } from 'net';
import { AsnResponse, CityResponse, Reader } from 'maxmind';

/**
 * What the system can know about the browser behind a request (a website can't read a MAC address):
 *  - a device id the web app keeps in that browser and sends as `x-device-id`;
 *  - a fingerprint of the browser's traits (`x-device-fp`), which survives clearing the browser;
 *  - a readable name built from the User-Agent;
 *  - the IP's place and provider, from offline databases (GEOIP_CITY_DB / GEOIP_ASN_DB, .mmdb files —
 *    e.g. DB-IP «IP to City Lite» and «IP to ASN Lite»). Without those files the place is just left out.
 */

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT = /^[a-f0-9]{16,64}$/;

export function cleanDeviceId(v: unknown): string | undefined {
  return typeof v === 'string' && DEVICE_ID.test(v) ? v : undefined;
}

export function cleanFingerprint(v: unknown): string | undefined {
  return typeof v === 'string' && FINGERPRINT.test(v) ? v : undefined;
}

/** «Chrome 130 · Windows · رایانه», «Safari 17 · iOS 17 · گوشی» … (null when there's no User-Agent). */
export function deviceLabel(ua?: string | null): string | null {
  if (!ua) return null;
  const m = (re: RegExp) => ua.match(re);
  let browser = 'مرورگر نامشخص';
  let r: RegExpMatchArray | null;
  if ((r = m(/Edg(?:e|A|iOS)?\/(\d+)/))) browser = `Edge ${r[1]}`;
  else if ((r = m(/OPR\/(\d+)/)) || (r = m(/Opera\/(\d+)/))) browser = `Opera ${r[1]}`;
  else if ((r = m(/SamsungBrowser\/(\d+)/))) browser = `Samsung Internet ${r[1]}`;
  else if ((r = m(/Firefox\/(\d+)/)) || (r = m(/FxiOS\/(\d+)/))) browser = `Firefox ${r[1]}`;
  else if ((r = m(/CriOS\/(\d+)/)) || (r = m(/Chrome\/(\d+)/))) browser = `Chrome ${r[1]}`;
  else if ((r = m(/Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/))) browser = `Safari ${r[1]}`;
  else if (/curl|wget|python|node-fetch|axios|PostmanRuntime|okhttp/i.test(ua)) browser = 'برنامه (غیر مرورگر)';

  let os = 'سیستم‌عامل نامشخص';
  if ((r = m(/Android (\d+)/))) os = `Android ${r[1]}`;
  else if ((r = m(/(?:iPhone|CPU) OS (\d+)/))) os = `iOS ${r[1]}`;
  else if ((r = m(/iPad.*OS (\d+)/))) os = `iPadOS ${r[1]}`;
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if ((r = m(/Mac OS X (\d+)[._](\d+)/))) os = `macOS ${r[1]}.${r[2]}`;
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  const kind = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'تبلت' : /Mobi|iPhone|Android/.test(ua) ? 'گوشی' : 'رایانه';
  return `${browser} · ${os} · ${kind}`;
}

export interface Place { label: string; lat: number | null; lon: number | null }

const logger = new Logger('GeoIP');
let readers: { city: Reader<CityResponse> | null; asn: Reader<AsnResponse> | null } | null = null;

function open<T extends CityResponse | AsnResponse>(path?: string): Reader<T> | null {
  if (!path) return null;
  if (!existsSync(path)) { logger.warn(`GeoIP database not found: ${path}`); return null; }
  try { return new Reader<T>(readFileSync(path)); } catch (e) { logger.error(`GeoIP database unreadable (${path}): ${String(e)}`); return null; }
}

function geo() {
  if (!readers) readers = { city: open<CityResponse>(process.env.GEOIP_CITY_DB), asn: open<AsnResponse>(process.env.GEOIP_ASN_DB) };
  return readers;
}

const isPrivate = (ip: string) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80:)/i.test(ip);

/** «Tehran، Iran — Asiatech» for a public IP when the databases are installed; null otherwise. */
export function placeOf(rawIp?: string | null): Place | null {
  const ip = (rawIp ?? '').replace(/^::ffff:/, '');
  if (!ip || !isIP(ip)) return null;
  if (isPrivate(ip)) return { label: 'شبکهٔ داخلی', lat: null, lon: null };
  const { city, asn } = geo();
  if (!city && !asn) return null;
  const c = city?.get(ip) ?? null;
  const a = asn?.get(ip) ?? null;
  const name = (n?: { fa?: string; en?: string }) => n?.fa ?? n?.en;
  const where = [name(c?.city?.names), name(c?.country?.names)].filter(Boolean).join('، ');
  const label = [where, a?.autonomous_system_organization].filter(Boolean).join(' — ');
  if (!label) return null;
  return { label, lat: c?.location?.latitude ?? null, lon: c?.location?.longitude ?? null };
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
