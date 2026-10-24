'use client';
import { Faq } from '../../components/Faq';
import { EstelamFrame, PANELS, SubHead } from '../shared';

/** سوالات متداول */
export default function EstelamFaq() {
  return (
    <EstelamFrame>
      {() => (
        <>
          <SubHead title={PANELS[3].label} icon={PANELS[3].icon} />
          <div className="est-card p-5"><Faq /></div>
        </>
      )}
    </EstelamFrame>
  );
}
