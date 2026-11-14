'use client';
import { EstelamFrame, NOTICE, SubHead } from '../shared';

/** «اعلام خسارت» of panel 3: the filing form comes here later. */
export default function EstelamNotice() {
  return (
    <EstelamFrame>
      {() => (
        <div className="est-card p-6 space-y-4">
          <SubHead title={NOTICE.label} icon={NOTICE.icon} />
          <p className="text-center py-8" style={{ color: 'var(--muted)' }}>به زودی</p>
        </div>
      )}
    </EstelamFrame>
  );
}
