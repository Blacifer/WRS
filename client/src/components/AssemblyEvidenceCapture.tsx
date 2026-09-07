/**
 * Assembly evidence — photographing an open bogie before the frame goes down
 * Indian Railways WRS Raipur
 *
 * WHAT THIS IS FOR
 * ----------------
 * A wagon leaves and something happens on the road. Whether a part was missing
 * when it left is currently answered by a ticked checklist item. This screen
 * exists so it can be answered with a photograph instead.
 *
 * There is no model here and nothing is counted. The photograph is the proof;
 * anything automatic comes later and, per docs/ASSEMBLY_COMPLETENESS.md, may
 * only ever raise a question — never clear one.
 *
 * WHY FOUR CAPTURES AND NOT ONE
 * -----------------------------
 * No single frame shows every pocket on a CASNUB bogie. Two sides per bogie,
 * two bogies per wagon. A wagon photographed from one side is not covered, and
 * this screen says so plainly rather than showing a green tick for a partial
 * set — a half-covered wagon that looks complete is worse than one that looks
 * untouched, because nobody goes back to it.
 *
 * WHY THE TAGS ARE NOT TYPED
 * --------------------------
 * `wagon_photos` is append-only. A row written with "BOGIE 1" where the shape
 * wants "BOGIE:BOGIE_1" is permanently mislabelled and silently absent from
 * the dataset. The tags come from buildAssemblyTags and the inspector can see
 * them but not edit them.
 */

import React, { useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.ts';
import { PhotoCaptureModal } from './PhotoCaptureModal.tsx';
import { CameraIcon, AlertTriangleIcon } from './Icons.tsx';
import type { WagonPhotoRecord } from '../../../shared/types.ts';
import {
  BOGIE_POSITIONS,
  BOGIE_SIDES,
  buildAssemblyTags,
  parseAssemblyTags,
  type BogiePosition,
  type BogieSide
} from '../../../shared/assembly/assemblyCapture.ts';
import { getWagonSpringConfig, springsPerBogie } from '../../../shared/classification/wagonTypes.ts';

interface AssemblyEvidenceCaptureProps {
  wagonNumber: string;
  /** The wagon's designation, e.g. BOXNHL. */
  designation: string | null | undefined;
  /** Photographs already on this wagon, used to show what is still missing. */
  existingPhotos: WagonPhotoRecord[];
  onClose: () => void;
  onUploaded: (photo: any) => void;
}

const positionLabel = (bogie: BogiePosition, side: BogieSide, isHi: boolean): string => {
  const b = bogie === 'BOGIE_1' ? (isHi ? 'बोगी 1' : 'Bogie 1') : isHi ? 'बोगी 2' : 'Bogie 2';
  const s = side === 'SIDE_A' ? (isHi ? 'साइड A' : 'Side A') : isHi ? 'साइड B' : 'Side B';
  return `${b} — ${s}`;
};

export const AssemblyEvidenceCapture: React.FC<AssemblyEvidenceCaptureProps> = ({
  wagonNumber,
  designation,
  existingPhotos,
  onClose,
  onUploaded
}) => {
  const { lang } = useI18n();
  const isHi = lang === 'hi';

  const [target, setTarget] = useState<{ bogiePosition: BogiePosition; side: BogieSide } | null>(null);

  const config = designation ? getWagonSpringConfig(designation) : null;

  /** Which of the four positions already have a photograph. */
  const captured = useMemo(() => {
    const done = new Set<string>();
    for (const photo of existingPhotos) {
      const parsed = parseAssemblyTags(photo.tags);
      if (parsed) done.add(`${parsed.bogiePosition}::${parsed.side}`);
    }
    return done;
  }, [existingPhotos]);

  const total = BOGIE_POSITIONS.length * BOGIE_SIDES.length;
  const doneCount = captured.size;

  /*
   * A wagon whose designation this system does not hold cannot be photographed
   * into the dataset, because the expected spring count is derived from the
   * designation and from nothing else. Refused here, with the reason, rather
   * than letting somebody take four photographs that quietly cannot be used.
   */
  if (!config) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-surface border border-line rounded-panel max-w-md w-full p-6 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-warn-ink shrink-0 mt-0.5"><AlertTriangleIcon size={18} /></span>
            <div>
              <h3 className="text-sm font-bold text-ink-body">
                {isHi ? 'इस वैगन प्रकार के लिए असेंबली साक्ष्य नहीं' : 'Assembly evidence not available for this wagon type'}
              </h3>
              <p className="text-xs text-ink-muted mt-2">
                {isHi
                  ? `"${designation || '—'}" रजिस्ट्री में नहीं है, इसलिए अपेक्षित स्प्रिंग संख्या निकाली नहीं जा सकती। फ़ोटो लिया जा सकता है, पर वह इस डेटासेट का हिस्सा नहीं बनेगा।`
                  : `"${designation || '—'}" is not in the wagon registry, so the expected spring count cannot be derived from it. A photograph could still be taken through the ordinary photo screen, but it would not belong to this dataset.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-control border border-line bg-raised text-sm font-bold text-ink-body"
          >
            {isHi ? 'बंद करें' : 'Close'}
          </button>
        </div>
      </div>
    );
  }

  if (target) {
    return (
      <PhotoCaptureModal
        wagonNumber={wagonNumber}
        category="SPRINGS"
        partName={`Bogie assembly — ${target.bogiePosition.replace('_', ' ')} ${target.side.replace('_', ' ')}`}
        stage="REASSEMBLY"
        // Built, never typed. See the header.
        fixedTags={buildAssemblyTags({
          designation: config.designation,
          bogiePosition: target.bogiePosition,
          side: target.side
        })}
        // Not a defect and not a before/after pair — this records a state.
        fixedEvidenceStage="GENERAL"
        onClose={() => setTarget(null)}
        onUploaded={(photo) => {
          setTarget(null);
          onUploaded(photo);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-panel max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-line">
          <h3 className="text-base font-bold text-ink-body">
            {isHi ? 'बोगी असेंबली साक्ष्य' : 'Bogie assembly evidence'}
          </h3>
          <p className="text-xs text-ink-muted mt-1">
            {wagonNumber} — {config.designation} · {config.bogieDescription}
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/*
            * The protocol, on the screen where it is followed.
            *
            * Fixed camera geometry does more for this than any later model
            * choice, and a protocol that lives only in a document is one that
            * drifts by the second shift.
            */}
          <div className="text-xs text-ink-muted bg-raised p-3 rounded-control border border-line space-y-1">
            <p className="font-semibold text-ink-body">
              {isHi ? 'कब फ़ोटो लें' : 'When to take these'}
            </p>
            <p>
              {isHi
                ? 'स्प्रिंग रखने के बाद, बोगी फ़्रेम नीचे करने से पहले — यही एकमात्र क्षण है जब सभी पॉकेट एक साथ दिखते हैं।'
                : 'After spring placement, before the bogie frame is lowered — the only moment when every pocket is visible at once.'}
            </p>
            <p>
              {isHi
                ? 'चिह्नित कैमरा स्थिति से खड़े हों। हर शिफ़्ट में वही स्थिति, वही रोशनी।'
                : 'Stand at the marked camera position. Same position and same lighting every shift — a pocket in shadow and an empty pocket look alike.'}
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs font-semibold text-ink-body">
                {isHi ? 'चारों स्थितियाँ' : 'All four positions'}
              </span>
              <span className="text-xs text-ink-muted">
                {doneCount} / {total}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {BOGIE_POSITIONS.map((bogie) =>
                BOGIE_SIDES.map((side) => {
                  const done = captured.has(`${bogie}::${side}`);
                  return (
                    <button
                      key={`${bogie}-${side}`}
                      type="button"
                      onClick={() => setTarget({ bogiePosition: bogie, side })}
                      className={`min-h-[64px] px-3 py-2 rounded-control border text-left transition ${
                        done
                          ? 'border-ok-line bg-ok-soft text-ok-ink'
                          : 'border-line bg-raised text-ink-muted hover:text-ink-body'
                      }`}
                    >
                      <span className="block text-xs font-bold">{positionLabel(bogie, side, isHi)}</span>
                      <span className="block text-[11px] mt-1 flex items-center gap-1">
                        {done ? (
                          isHi ? 'लिया गया — दोबारा लें' : 'Captured — retake'
                        ) : (
                          <>
                            <CameraIcon size={12} />
                            {isHi ? 'लेना बाकी' : 'Not yet taken'}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/*
            * Deliberately not a green "complete" banner.
            *
            * Four photographs prove four photographs were taken. Whether every
            * pocket was occupied is a question a person answers by looking at
            * them, and a tick here would be read as the system having checked.
            */}
          <p className="text-[11px] text-ink-muted leading-relaxed">
            {isHi
              ? `इन तस्वीरों से कुछ स्वतः जाँचा नहीं जाता। ये ${springsPerBogie(config)} स्प्रिंग प्रति बोगी (${config.counts.outer}/${config.counts.inner}/${config.counts.snubber}) का रिकॉर्ड हैं, जिसे बाद में कोई व्यक्ति देख सकता है।`
              : `Nothing is checked automatically from these. They are the record a person can look at later — this wagon carries ${springsPerBogie(config)} springs per bogie (${config.counts.outer} outer / ${config.counts.inner} inner / ${config.counts.snubber} snubber), per ${config.tableRef}.`}
          </p>
        </div>

        <div className="px-6 py-4 border-t border-line bg-raised">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-control border border-line bg-surface text-sm font-bold text-ink-body"
          >
            {isHi ? 'बंद करें' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
