import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/** One HTTP route and the access markers on it (decorators on the method or its controller). */
export interface RouteInfo {
  file: string;
  controller: string;
  handler: string;
  method: string;
  path: string;
  isPublic: boolean;
  superOnly: boolean;
  permissions: string[];
  realms: string[];
  entry: 'only' | 'allowed' | null;
}

const HTTP = /^@(Get|Post|Put|Patch|Delete|All)\((?:'([^']*)')?/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.controller\.ts$/.test(f) ? [p] : [];
  });
}

const join2 = (a: string, b: string) => `/${[a, b].map((x) => x.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;

interface Marks { isPublic: boolean; superOnly: boolean; permissions: string[]; realms: string[]; entry: 'only' | 'allowed' | null; http?: { method: string; path: string } }

function marks(decorators: string[]): Marks {
  const all = decorators.join(' ');
  const args = (name: string) => [...all.matchAll(new RegExp(`@${name}\\(([^)]*)\\)`, 'g'))].flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
  const http = decorators.map((d) => HTTP.exec(d)).find(Boolean);
  return {
    isPublic: /@Public\(\)/.test(all),
    superOnly: /@SuperAdminOnly\(\)/.test(all),
    permissions: args('Permissions'),
    realms: args('Realms').map((r) => r.replace(/'/g, '')),
    entry: /@EntryOnly\(\)/.test(all) ? 'only' : /@EntryAllowed\(\)/.test(all) ? 'allowed' : null,
    ...(http ? { http: { method: http[1].toUpperCase(), path: http[2] ?? '' } } : {}),
  };
}

/**
 * Every route of every controller under `src/modules`, read from the decorators in the source — the A/B/C
 * access audit (route-access.spec.ts) checks each one against the panels' rules. Read as text, not loaded,
 * so the check needs no database or module wiring.
 */
export function routeInventory(modulesDir: string): RouteInfo[] {
  const out: RouteInfo[] = [];
  for (const f of files(modulesDir)) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    let pending: string[] = [];
    let ctl: { name: string; base: string; marks: Marks } | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('@')) { pending.push(line); continue; }
      const cls = /^export class (\w+)/.exec(line);
      if (cls) {
        const base = pending.map((d) => /^@Controller\('([^']*)'\)/.exec(d)?.[1]).find((x) => x !== undefined);
        ctl = base !== undefined ? { name: cls[1], base, marks: marks(pending) } : null;
        pending = [];
        continue;
      }
      const sig = /^(?:async\s+)?(\w+)\s*\(/.exec(line);
      if (sig && ctl && pending.length) {
        const m = marks(pending);
        if (m.http) {
          const c = ctl.marks;
          out.push({
            file: relative(modulesDir, f).replace(/\\/g, '/'), controller: ctl.name, handler: sig[1], method: m.http.method, path: join2(ctl.base, m.http.path),
            isPublic: m.isPublic || c.isPublic, superOnly: m.superOnly || c.superOnly,
            permissions: m.permissions.length ? m.permissions : c.permissions,
            realms: m.realms.length ? m.realms : c.realms,
            entry: m.entry ?? c.entry,
          });
        }
        pending = [];
        continue;
      }
      if (line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) {
        // a decorator's argument running onto the next line stays with it; anything else ends the block
        if (pending.length && !/^[)\]}'",]/.test(line) && !/^\w+:/.test(line)) pending = [];
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
