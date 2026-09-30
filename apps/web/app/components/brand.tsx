export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #ffb84d, #ff9500 55%, #ff7a00)',
        boxShadow: '0 6px 16px -6px rgba(255,149,0,0.7)',
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2.5l7 3v5.5c0 4.2-2.9 7.7-7 8.9-4.1-1.2-7-4.7-7-8.9V5.5l7-3z"
          fill="rgba(255,255,255,0.18)"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M8.7 12.2l2.2 2.2 4.2-4.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
