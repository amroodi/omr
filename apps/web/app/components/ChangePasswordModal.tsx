'use client';
import { useState } from 'react';
import { client, Realm } from '../../lib/client';
import { Field } from './ui';

/** Self-service password change for any authenticated realm (super or org). */
export function ChangePasswordModal({ realm = 'super', onClose }: { realm?: Realm; onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMsg(null);
    if (next.length < 8) return setMsg({ t: 'err', m: 'رمز جدید باید حداقل ۸ کاراکتر باشد' });
    if (next !== confirm) return setMsg({ t: 'err', m: 'رمز جدید و تکرار آن یکسان نیستند' });
    setBusy(true);
    try {
      await client.post('/auth/change-password', { currentPassword: cur, newPassword: next }, realm);
      setMsg({ t: 'ok', m: 'رمز عبور با موفقیت تغییر کرد' });
      setCur(''); setNext(''); setConfirm('');
      setTimeout(onClose, 1200);
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card p-5 space-y-3" style={{ width: '100%', maxWidth: 380 }}>
        <div className="flex justify-between items-center">
          <h3 className="font-bold">تغییر رمز عبور</h3>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--muted)' }}>✕</button>
        </div>
        {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
        <Field label="رمز فعلی"><input type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="رمز جدید (حداقل ۸ کاراکتر)"><input type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" style={{ direction: 'ltr', textAlign: 'left' }} /></Field>
        <Field label="تکرار رمز جدید"><input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" style={{ direction: 'ltr', textAlign: 'left' }} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
        <button onClick={submit} disabled={busy || !cur || !next} className="btn btn-primary w-full btn-sm">{busy ? '…' : 'ثبت رمز جدید'}</button>
      </div>
    </div>
  );
}
