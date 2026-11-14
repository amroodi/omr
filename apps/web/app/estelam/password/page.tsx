'use client';
import { useState } from 'react';
import { inquiryApi } from '../../../lib/api';
import { Flash } from '../../components/Toaster';
import { EstelamFrame, SubHead } from '../shared';

const LOCK = 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4';

/** «تغییر رمز عبور» of a panel-3 password login. */
function ChangePassword({ token }: { token: string }) {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.next !== f.again) { setNote({ ok: false, text: 'تکرار رمز عبور جدید یکسان نیست' }); return; }
    setBusy(true); setNote(null);
    try { await inquiryApi.changePassword(token, f.current, f.next); setF({ current: '', next: '', again: '' }); setNote({ ok: true, text: 'رمز عبور تغییر کرد' }); }
    catch (e: any) { setNote({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="est-card p-5 space-y-3" style={{ maxWidth: 420 }}>
      <input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} placeholder="رمز عبور فعلی" />
      <input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} placeholder="رمز عبور جدید (حداقل ۶ کاراکتر)" />
      <input className="input" type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} placeholder="تکرار رمز عبور جدید" />
      <Flash id={note} text={note?.text} ok={!!note && note.ok} />
      <button className="est-btn" disabled={busy || !f.current || f.next.length < 6 || !f.again} onClick={save}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</button>
    </div>
  );
}

export default function EstelamPassword() {
  return (
    <EstelamFrame>
      {(_r, token) => (
        <>
          <SubHead title="تغییر رمز عبور" icon={LOCK} />
          {token && <ChangePassword token={token} />}
        </>
      )}
    </EstelamFrame>
  );
}
