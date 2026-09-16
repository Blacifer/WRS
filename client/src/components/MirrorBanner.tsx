/**
 * The mirror says what it is
 * Indian Railways WRS Raipur
 *
 * A read-only copy at division headquarters looks exactly like the shop's
 * own screen, which is the point and the danger: a DRM could read a
 * three-day-old number as this morning's. So the mirror wears a band across
 * the top saying when its copy was taken, and every attempt to write is
 * refused by the server anyway.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';

export const MirrorBanner: React.FC<{ lang: 'en' | 'hi' }> = ({ lang }) => {
  const isHi = lang === 'hi';
  const [mirror, setMirror] = useState<{ readOnly: boolean; restoredAt: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    api.getHealth().then((j) => { if (live && j?.mirror?.readOnly) setMirror(j.mirror); }).catch(() => { /* not a mirror, or offline */ });
    return () => { live = false; };
  }, []);
  if (!mirror?.readOnly) return null;
  const when = mirror.restoredAt ? new Date(mirror.restoredAt).toLocaleString(isHi ? 'hi-IN' : 'en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : (isHi ? 'अज्ञात' : 'unknown');
  return (
    <div className="bg-warn-soft border-b border-warn-line text-warn-ink text-xs font-semibold px-4 py-2 text-center" data-testid="mirror-banner">
      {isHi
        ? `यह वर्कशॉप के रिकॉर्ड की केवल-पढ़ने योग्य प्रति है, ${when} के बैकअप से। यहाँ कुछ दर्ज नहीं किया जा सकता।`
        : `Read-only mirror of the workshop's record, restored from the backup of ${when}. Nothing can be recorded here.`}
    </div>
  );
};

export default MirrorBanner;
