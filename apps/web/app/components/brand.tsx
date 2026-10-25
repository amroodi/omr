/**
 * The brokerage's emblem (umbrella, twin homas, gear) as the app's brand icon. It sits on a small white
 * rounded tile so the navy gear stays visible on dark bars and in dark mode.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: size * 0.26, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff', boxShadow: '0 4px 12px -6px rgba(1,33,65,0.45)',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/damuon-mark.webp" alt="" width={Math.round(size * 0.84)} height={Math.round(size * 0.84)} style={{ objectFit: 'contain' }} />
    </span>
  );
}

/** The full logo with the brokerage's name underneath — for the login cards. */
export function BrandLogo({ height = 120 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/damuon-logo.webp" alt="کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون" style={{ height, width: 'auto', objectFit: 'contain' }} />;
}
