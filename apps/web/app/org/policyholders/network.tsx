'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toGregorian } from 'jalaali-js';
import { client, hasPerm } from '../../../lib/client';
import { Field, Spinner } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { Overlay } from '../../components/ui';
import { appZoom } from '../../../lib/scale';

interface Contract { id: string; insurerTenantId: string; insurerName: string; policyNumber: string | null; startDate: string | null; endDate: string | null; isActive: boolean; isCurrent: boolean }
interface Company { id: string; name: string; parentId: string | null; isActive: boolean; hasLogo: boolean; accounts: number; currentInsurer: { id: string; name: string } | null; contracts: Contract[] }
interface Insurer { id: string; name: string; slug: string; hasLogo: boolean; color: string; companies: number }
interface Network { broker: { name: string; slug: string; hasLogo: boolean }; companies: Company[]; insurers: Insurer[]; available: { id: string; name: string }[] }
interface Line { key: string; d: string; color: string; dashed?: boolean; width: number; dim: boolean }

const fa = (n: number) => n.toLocaleString('fa-IR');
function jalaliToIso(v: string): string | null {
  const p = v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((x) => !x)) return null;
  const g = toGregorian(p[0], p[1], p[2]);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).toISOString();
}

/**
 * «نقشهٔ اتصال‌ها» — بیمه‌گزار companies connect to this کارگزاری, and the کارگزاری connects each of them
 * to one of its insurers (through a dated contract). Click a company, then an insurer, to connect them.
 */
export function NetworkTab({ setMsg, onChanged }: { setMsg: (m: { t: 'ok' | 'err'; m: string } | null) => void; onChanged: () => void }) {
  const [net, setNet] = useState<Network | null>(null);
  const [sel, setSel] = useState<{ kind: 'company' | 'insurer'; id: string } | null>(null);
  const [connect, setConnect] = useState<{ company: Company; insurer: Insurer } | null>(null);
  const [k, setK] = useState({ policyNumber: '', start: '', end: '' });
  const [newCo, setNewCo] = useState('');
  const [addIns, setAddIns] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [stacked, setStacked] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<Record<string, HTMLElement | null>>({});
  const canPartner = hasPerm('org', 'tenant:settings');

  const load = useCallback(() => client.get<Network>('/policyholder-companies/network', 'org').then(setNet).catch((e) => setMsg({ t: 'err', m: e.message })), [setMsg]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<any>, ok: string) => { setMsg(null); try { await fn(); setMsg({ t: 'ok', m: ok }); await load(); onChanged(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };

  const colorOf = (insurerId: string | undefined) => net?.insurers.find((i) => i.id === insurerId)?.color ?? 'var(--muted)';

  // Draw the connection lines from the nodes' on-screen positions (recomputed on any resize).
  const draw = useCallback(() => {
    const board = boardRef.current;
    if (!board || !net) return;
    const b = board.getBoundingClientRect();
    const isStacked = board.clientWidth < 720;
    setStacked(isStacked);
    // Screen px → the board's own px (the page may be zoomed on desktop, see lib/scale.ts).
    const z = appZoom();
    const rect = (key: string) => {
      const el = nodes.current[key]; if (!el) return null;
      const r = el.getBoundingClientRect();
      const l = (r.left - b.left) / z, rr = (r.right - b.left) / z, t = (r.top - b.top) / z, bt = (r.bottom - b.top) / z;
      return { l, r: rr, t, bt, cx: (l + rr) / 2, cy: (t + bt) / 2 };
    };
    const hub = rect('broker');
    if (!hub) return;
    const curve = (sx: number, sy: number, ex: number, ey: number) => isStacked
      ? `M${sx},${sy} C${sx},${(sy + ey) / 2} ${ex},${(sy + ey) / 2} ${ex},${ey}`
      : `M${sx},${sy} C${(sx + ex) / 2},${sy} ${(sx + ex) / 2},${ey} ${ex},${ey}`;
    const out: Line[] = [];
    const selCompany = sel?.kind === 'company' ? net.companies.find((c) => c.id === sel.id) : null;
    for (const c of net.companies) {
      const n = rect(`c:${c.id}`); if (!n) continue;
      const ins = c.currentInsurer?.id;
      const dim = !!sel && !(sel.kind === 'company' ? sel.id === c.id : sel.id === ins);
      const d = isStacked ? curve(n.cx, n.bt, hub.cx, hub.t) : curve(n.l, n.cy, hub.r, hub.cy); // RTL: companies on the right
      out.push({ key: `c-${c.id}`, d, color: ins ? colorOf(ins) : 'var(--muted)', dashed: !ins || !c.isActive, width: 2, dim });
    }
    for (const i of net.insurers) {
      const n = rect(`i:${i.id}`); if (!n) continue;
      const dim = !!sel && !(sel.kind === 'insurer' ? sel.id === i.id : selCompany?.currentInsurer?.id === i.id);
      const d = isStacked ? curve(hub.cx, hub.bt, n.cx, n.t) : curve(hub.l, hub.cy, n.r, n.cy);
      out.push({ key: `i-${i.id}`, d, color: i.color, dashed: i.companies === 0, width: Math.min(2 + i.companies, 7), dim });
    }
    setLines(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, sel]);
  useLayoutEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const board = boardRef.current; if (!board) return;
    const ro = new ResizeObserver(() => draw()); ro.observe(board);
    window.addEventListener('resize', draw);
    return () => { ro.disconnect(); window.removeEventListener('resize', draw); };
  }, [draw]);

  const clickCompany = (c: Company) => setSel((s) => (s?.kind === 'company' && s.id === c.id ? null : { kind: 'company', id: c.id }));
  const clickInsurer = (i: Insurer) => {
    if (sel?.kind === 'company') {
      const company = net!.companies.find((c) => c.id === sel.id)!;
      setK({ policyNumber: '', start: '', end: '' });
      setConnect({ company, insurer: i });
      return;
    }
    setSel((s) => (s?.kind === 'insurer' && s.id === i.id ? null : { kind: 'insurer', id: i.id }));
  };
  const saveContract = () => connect && act(async () => {
    const startDate = k.start ? jalaliToIso(k.start) : new Date().toISOString();
    const endDate = k.end ? jalaliToIso(k.end) : null;
    if ((k.start && !startDate) || (k.end && !endDate)) throw new Error('تاریخ نامعتبر است (نمونه: ۱۴۰۵/۰۱/۰۱)');
    await client.post(`/policyholder-companies/${connect.company.id}/contracts`, { insurerTenantId: connect.insurer.id, policyNumber: k.policyNumber || null, startDate, endDate }, 'org');
    setConnect(null);
  }, `«${connect.company.name}» از طریق کارگزاری به «${connect.insurer.name}» متصل شد.`);

  if (!net) return <div className="card p-8 text-center"><Spinner /></div>;
  const selCompany = sel?.kind === 'company' ? net.companies.find((c) => c.id === sel.id) : null;
  const selInsurer = sel?.kind === 'insurer' ? net.insurers.find((i) => i.id === sel.id) : null;
  const brokerLogo = net.broker.hasLogo ? `${client.base}/tenant/assets/logo?tenant=${net.broker.slug}` : null;
  const nodeStyle = (on: boolean, faded: boolean) => ({ opacity: faded ? 0.4 : 1, boxShadow: on ? '0 0 0 2px var(--brand)' : undefined, transition: 'opacity .15s, box-shadow .15s' });

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm leading-7">
        <b>نحوهٔ اتصال:</b> هر بیمه‌گزار به کارگزاری متصل است و کارگزاری او را با یک قرارداد (شماره بیمه‌نامه و بازهٔ تاریخ) به یکی از بیمه‌گرهای همکار وصل می‌کند.
        برای اتصال، <b>روی بیمه‌گزار و سپس روی بیمه‌گر</b> کلیک کنید. پرونده‌های این بیمه‌گزار بر اساس قرارداد معتبر در تاریخ فوت، خودکار به همان بیمه‌گر ارسال می‌شوند.
      </div>

      {/* Quick add: a company (right) / an insurer partner (left) */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card p-3 flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[180px]"><Field label="بیمه‌گزار جدید"><input className="input" value={newCo} onChange={(e) => setNewCo(e.target.value)} placeholder="نام شرکت" /></Field></div>
          <button className="btn btn-primary btn-sm" disabled={newCo.trim().length < 2} onClick={() => act(async () => { await client.post('/policyholder-companies', { name: newCo.trim() }, 'org'); setNewCo(''); }, 'بیمه‌گزار اضافه شد')}>افزودن</button>
        </div>
        {canPartner && (
          <div className="card p-3 flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <Field label="افزودن بیمه‌گر همکار">
                <select className="input" value={addIns} onChange={(e) => setAddIns(e.target.value)}>
                  <option value="">{net.available.length ? '— بیمه‌گرهای ثبت‌شده در سامانه —' : 'بیمه‌گر دیگری در سامانه ثبت نشده است'}</option>
                  {net.available.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
            </div>
            <button className="btn btn-primary btn-sm" disabled={!addIns} onClick={() => act(async () => { await client.put(`/policyholder-companies/partners/${addIns}`, { enabled: true }, 'org'); setAddIns(''); }, 'همکاری با بیمه‌گر برقرار شد')}>افزودن</button>
          </div>
        )}
      </div>

      {/* The map */}
      <div ref={boardRef} className="card p-4" style={{ position: 'relative' }}>
        <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          {lines.map((l) => (
            <path key={l.key} d={l.d} fill="none" stroke={l.color} strokeWidth={l.width} strokeLinecap="round"
              strokeDasharray={l.dashed ? '6 6' : undefined} opacity={l.dim ? 0.12 : 0.85} style={{ transition: 'opacity .15s' }} />
          ))}
        </svg>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: stacked ? 'minmax(0,1fr)' : 'minmax(0,1fr) 180px minmax(0,1fr)', gap: stacked ? 36 : 64, alignItems: 'center' }}>
          {/* RIGHT (first in RTL): بیمه‌گزارها */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-center" style={{ color: 'var(--muted)' }}>بیمه‌گزارها ({fa(net.companies.length)})</div>
            {net.companies.length === 0 && <div className="text-xs text-center p-3" style={{ color: 'var(--muted)' }}>بیمه‌گزاری ثبت نشده است</div>}
            {net.companies.map((c) => {
              const on = sel?.kind === 'company' && sel.id === c.id;
              const faded = !!sel && !on && !(sel.kind === 'insurer' && c.currentInsurer?.id === sel.id);
              return (
                <button key={c.id} ref={(el) => { nodes.current[`c:${c.id}`] = el; }} type="button" onClick={() => clickCompany(c)}
                  className="w-full rounded-xl p-2.5 flex items-center gap-2 text-right" aria-pressed={on}
                  style={{ background: 'var(--surface)', border: `1px solid ${c.currentInsurer ? colorOf(c.currentInsurer.id) : 'var(--border)'}`, ...nodeStyle(on, faded) }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.hasLogo ? <img src={`${client.base}/policyholder-companies/${c.id}/logo`} alt="" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
                    : <span className="rounded-lg flex items-center justify-center text-xs font-bold shrink-0" style={{ width: 28, height: 28, background: 'var(--surface-2)' }}>{c.name.slice(0, 1)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold truncate">{c.name}{c.parentId && <span className="text-[10px] font-normal mr-1 px-1.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>زیرمجموعه</span>}</span>
                    <span className="block text-[11px] truncate" style={{ color: c.currentInsurer ? colorOf(c.currentInsurer.id) : 'var(--warning)' }}>
                      {c.currentInsurer ? `← ${c.currentInsurer.name}` : 'به بیمه‌گری متصل نیست'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* CENTRE: کارگزاری (the intermediary) */}
          <div ref={(el) => { nodes.current.broker = el; }} className="rounded-2xl p-4 text-center" style={{ background: 'var(--brand-soft)', border: '2px solid var(--brand)', justifySelf: 'center', width: stacked ? 'min(100%, 260px)' : '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brokerLogo && <img src={brokerLogo} alt="" style={{ height: 44, maxWidth: '100%', objectFit: 'contain', margin: '0 auto 6px' }} />}
            <div className="text-xs" style={{ color: 'var(--muted)' }}>کارگزاری (واسط)</div>
            <div className="font-extrabold text-sm leading-6">{net.broker.name}</div>
          </div>

          {/* LEFT: بیمه‌گرها */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-center" style={{ color: 'var(--muted)' }}>بیمه‌گرهای همکار ({fa(net.insurers.length)})</div>
            {net.insurers.length === 0 && <div className="text-xs text-center p-3" style={{ color: 'var(--muted)' }}>هنوز با بیمه‌گری همکاری ثبت نشده است</div>}
            {net.insurers.map((i) => {
              const on = sel?.kind === 'insurer' && sel.id === i.id;
              const target = sel?.kind === 'company';
              const faded = !!sel && !on && !target && !(selCompany?.currentInsurer?.id === i.id);
              return (
                <button key={i.id} ref={(el) => { nodes.current[`i:${i.id}`] = el; }} type="button" onClick={() => clickInsurer(i)}
                  className="w-full rounded-xl p-2.5 flex items-center gap-2 text-right" aria-pressed={on}
                  title={target ? `اتصال «${selCompany?.name}» به ${i.name}` : i.name}
                  style={{ background: 'var(--surface)', border: `2px ${target ? 'dashed' : 'solid'} ${i.color}`, ...nodeStyle(on || selCompany?.currentInsurer?.id === i.id, faded) }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {i.hasLogo ? <img src={`${client.base}/tenant/assets/logo?tenant=${i.slug}`} alt="" style={{ width: 30, height: 30, objectFit: 'contain', flexShrink: 0 }} />
                    : <span className="rounded-lg shrink-0" style={{ width: 30, height: 30, background: i.color }} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold truncate">{i.name}</span>
                    <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{target ? 'برای اتصال کلیک کنید' : `${fa(i.companies)} بیمه‌گزار`}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Details of the selection */}
      {selCompany && (
        <div className="card p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <b>{selCompany.name}</b>
            <span style={{ color: 'var(--muted)' }}>برای اتصال به بیمه‌گر، روی یکی از بیمه‌گرها کلیک کنید</span>
          </div>
          {selCompany.contracts.length === 0 ? <div style={{ color: 'var(--muted)' }}>قراردادی ثبت نشده است.</div> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr>{['بیمه‌گر', 'شماره بیمه‌نامه', 'از', 'تا', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {selCompany.contracts.map((ct) => (
                    <tr key={ct.id}>
                      <td className="font-semibold">{ct.insurerName}{ct.isCurrent && <span className="badge badge-success mr-1">فعلی</span>}</td>
                      <td>{ct.policyNumber || '—'}</td><td>{ct.startDate || 'نامحدود'}</td><td>{ct.endDate || 'نامحدود'}</td>
                      <td>{ct.isActive ? 'فعال' : 'غیرفعال'}</td>
                      <td><button className="text-xs" style={{ color: ct.isActive ? 'var(--danger)' : 'var(--success)' }}
                        onClick={() => act(() => client.patch(`/policyholder-companies/${selCompany.id}/contracts/${ct.id}`, { isActive: !ct.isActive }, 'org'), ct.isActive ? 'قرارداد غیرفعال شد' : 'قرارداد فعال شد')}>
                        {ct.isActive ? 'قطع اتصال' : 'فعال‌سازی'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {selInsurer && (
        <div className="card p-4 text-sm flex items-center justify-between gap-2 flex-wrap">
          <span><b>{selInsurer.name}</b> — {fa(selInsurer.companies)} بیمه‌گزار از طریق کارگزاری به این بیمه‌گر متصل است.</span>
          {canPartner && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
              onClick={() => { if (window.confirm(`پایان همکاری با «${selInsurer.name}»؟`)) act(async () => { await client.put(`/policyholder-companies/partners/${selInsurer.id}`, { enabled: false }, 'org'); setSel(null); }, 'همکاری با بیمه‌گر پایان یافت'); }}>
              پایان همکاری با این بیمه‌گر
            </button>
          )}
        </div>
      )}

      {/* Connect dialog */}
      {connect && (
        <Overlay onClose={() => setConnect(null)}>
          <div className="pmodal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">اتصال بیمه‌گزار به بیمه‌گر</span>
              <button className="pmodal-x" onClick={() => setConnect(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3 text-sm">
              <div className="flex items-center justify-center gap-2 flex-wrap font-bold text-center">
                <span>{connect.company.name}</span><span style={{ color: 'var(--muted)' }}>←</span>
                <span style={{ color: 'var(--brand)' }}>{net.broker.name}</span><span style={{ color: 'var(--muted)' }}>←</span>
                <span style={{ color: connect.insurer.color }}>{connect.insurer.name}</span>
              </div>
              {connect.company.currentInsurer && connect.company.currentInsurer.id !== connect.insurer.id && (
                <div className="text-xs rounded-lg p-2" style={{ background: 'var(--warning-soft)' }}>
                  این بیمه‌گزار اکنون به «{connect.company.currentInsurer.name}» متصل است. با شروع قرارداد جدید از تاریخ زیر، پرونده‌های فوتِ بعد از آن تاریخ به «{connect.insurer.name}» می‌روند؛ پرونده‌های قبلی تغییر نمی‌کنند.
                </div>
              )}
              <Field label="شماره بیمه‌نامه"><input className="input" value={k.policyNumber} onChange={(e) => setK({ ...k, policyNumber: e.target.value })} /></Field>
              <div className="grid sm:grid-cols-2 gap-2">
                <Field label="از تاریخ (خالی = امروز)"><JalaliDatePicker value={k.start} onChange={(v) => setK({ ...k, start: v })} placeholder="۱۴۰۵/۰۱/۰۱" /></Field>
                <Field label="تا تاریخ (خالی = نامحدود)"><JalaliDatePicker value={k.end} onChange={(v) => setK({ ...k, end: v })} placeholder="۱۴۰۵/۱۲/۲۹" /></Field>
              </div>
            </div>
            <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setConnect(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
              <button onClick={saveContract} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>ثبت اتصال</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
