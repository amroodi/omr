'use client';
import { InputHTMLAttributes, useState } from 'react';

/**
 * A password field with an eye button: the password shows only while the button is held down (mouse,
 * finger, or Space/Enter on it) and hides again on release. The eye stays out of Tab / PageDown order.
 * `plain` renders an ordinary text field (for forms where only some fields are secret).
 */
export function PasswordInput({ plain, style, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { plain?: boolean }) {
  const [show, setShow] = useState(false);
  if (plain) return <input {...rest} type="text" style={style} className={className} />;
  const hide = () => setShow(false);
  return (
    <span className="pw-wrap">
      <input {...rest} type={show ? 'text' : 'password'} className={className} style={{ ...style, paddingLeft: 40 }} />
      <button type="button" className="pw-eye" tabIndex={-1} aria-label="نمایش رمز (نگه دارید)" title="برای دیدن رمز نگه دارید"
        aria-pressed={show}
        onMouseDown={(e) => e.preventDefault() /* keep the cursor in the field */}
        onPointerDown={(e) => { e.preventDefault(); setShow(true); }}
        onPointerUp={hide} onPointerLeave={hide} onPointerCancel={hide} onBlur={hide}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setShow(true); } }}
        onKeyUp={hide}
        onContextMenu={(e) => e.preventDefault()}>
        {show ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.5 8 3 10.1 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5-1.6" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </span>
  );
}
