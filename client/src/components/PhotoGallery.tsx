/**
 * Photo Evidence Gallery with Subsystem Filters & Before/After Comparison
 * Indian Railways WRS Raipur (Phase 2 - R5)
 */

import React, { useState } from 'react';
import { useI18n } from '../i18n/index.ts';
import type { WagonPhotoRecord } from '../../../shared/types.ts';

interface PhotoGalleryProps {
  photos: WagonPhotoRecord[];
  onAddPhotoClick?: () => void;
  onSmartVisionClick?: () => void;
}

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({ photos, onAddPhotoClick, onSmartVisionClick }) => {
  const { t, lang } = useI18n();
  const isHi = lang === 'hi';
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [comparisonBefore, setComparisonBefore] = useState<WagonPhotoRecord | null>(null);
  const [comparisonAfter, setComparisonAfter] = useState<WagonPhotoRecord | null>(null);
  const [activeLightboxPhoto, setActiveLightboxPhoto] = useState<WagonPhotoRecord | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  const categories = [
    'ALL',
    'SPRINGS',
    'WHEELS_AXLES',
    'BEARINGS',
    'BRAKE_SYSTEM',
    'COUPLERS_DRAFT_GEAR',
    'BOGIE_FRAME_BOLSTER',
    'FRICTION_WEDGES',
    'BODY_UNDERFRAME'
  ];

  const filteredPhotos = photos.filter((p) => {
    if (selectedCategory === 'ALL') return true;
    return p.category === selectedCategory || p.partCategory === selectedCategory;
  });

  return (
    <div className="space-y-6">
      {/* Category Filter Pills & Add Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedCategory === cat
                  ? 'bg-orange-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-750'
              }`}
            >
              {cat === 'ALL' ? t('photos.allCategories') : (t(`checklist.categories.${cat}` as any) || cat)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {onSmartVisionClick && (
            <button
              onClick={onSmartVisionClick}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm min-h-[40px]"
            >
              <span>🤖</span> {t('photos.smartVisionScan') || 'Smart Vision AR Scan'}
            </button>
          )}

          {onAddPhotoClick && (
            <button
              onClick={onAddPhotoClick}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm min-h-[40px]"
            >
              📸 {t('photos.takePhoto')}
            </button>
          )}
        </div>
      </div>

      {/* Before / After Comparison Workbench if two photos are selected */}
      {(comparisonBefore || comparisonAfter) && (
        <div className="bg-slate-900 border-2 border-orange-500/40 rounded-xl p-5 shadow-xl space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-bold text-orange-400 flex items-center gap-2">
              <span>⚖️</span> {t('photos.beforeAfter')}
            </h4>
            <button
              onClick={() => {
                setComparisonBefore(null);
                setComparisonAfter(null);
              }}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded"
            >{isHi ? 'तुलना रीसेट करें' : 'Reset Comparison'}</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Before Slot */}
            <div className="border border-slate-800 rounded-lg p-3 bg-slate-950/60 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-rose-400">
                <span>{isHi ? 'पहले (दोष / आगमन)' : 'BEFORE (Defect / Intake)'}</span>
                {comparisonBefore && (
                  <button onClick={() => setComparisonBefore(null)} className="text-slate-400 hover:text-white">✕</button>
                )}
              </div>
              {comparisonBefore ? (
                <div className="aspect-video bg-black rounded overflow-hidden cursor-pointer" onClick={() => setActiveLightboxPhoto(comparisonBefore)}>
                  <img src={comparisonBefore.imageData || comparisonBefore.imageBase64 || (comparisonBefore as any).url} alt="Before" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="aspect-video border-2 border-dashed border-slate-800 rounded flex items-center justify-center text-xs text-slate-500">{isHi ? 'नीचे से \'पहले\' हेतु फ़ोटो चुनें' : 'Select a photo below to set as Before'}</div>
              )}
            </div>

            {/* After Slot */}
            <div className="border border-slate-800 rounded-lg p-3 bg-slate-950/60 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-emerald-400">
                <span>{isHi ? 'बाद (मरम्मत / प्रतिस्थापित)' : 'AFTER (Repaired / Replaced)'}</span>
                {comparisonAfter && (
                  <button onClick={() => setComparisonAfter(null)} className="text-slate-400 hover:text-white">✕</button>
                )}
              </div>
              {comparisonAfter ? (
                <div className="aspect-video bg-black rounded overflow-hidden cursor-pointer" onClick={() => setActiveLightboxPhoto(comparisonAfter)}>
                  <img src={comparisonAfter.imageData || comparisonAfter.imageBase64 || (comparisonAfter as any).url} alt="After" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="aspect-video border-2 border-dashed border-slate-800 rounded flex items-center justify-center text-xs text-slate-500">{isHi ? 'नीचे से \'बाद\' हेतु फ़ोटो चुनें' : 'Select a photo below to set as After'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photos Grid */}
      {filteredPhotos.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 rounded-xl border border-slate-800 text-slate-400">
          <div className="text-4xl mb-2">📷</div>
          <p className="text-sm">No photo evidence recorded for this category yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredPhotos.map((photo) => {
            const imgSrc = photo.imageData || photo.imageBase64 || (photo as any).url || '';
            const isBefore = comparisonBefore?.id === photo.id;
            const isAfter = comparisonAfter?.id === photo.id;

            return (
              <div
                key={photo.id}
                className={`bg-slate-900 border rounded-xl overflow-hidden shadow-lg transition-all group ${
                  isBefore
                    ? 'border-rose-500 ring-2 ring-rose-500/40'
                    : isAfter
                    ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Thumbnail */}
                <div
                  className="aspect-video bg-black relative cursor-pointer overflow-hidden"
                  onClick={() => setActiveLightboxPhoto(photo)}
                >
                  <img
                    src={imgSrc}
                    alt={photo.partName}
                    className="w-full h-full object-contain group-hover:scale-105 transition duration-300"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                    <span className="text-[10px] text-white font-medium">🔍 Click to inspect & zoom</span>
                  </div>
                </div>

                {/* Metadata */}
                <div className="p-3 space-y-2">
                  <div>
                    <h5 className="text-xs font-bold text-white truncate">{photo.partName}</h5>
                    <p className="text-[11px] text-slate-400 truncate">
                      {photo.category || photo.partCategory} • {photo.stage}
                    </p>
                  </div>

                  <div className="text-[10px] text-slate-500 flex justify-between items-center border-t border-slate-800/80 pt-2">
                    <span>{photo.inspectorName || 'Inspector'}</span>
                    <span>{photo.capturedAt ? new Date(photo.capturedAt).toLocaleDateString() : ''}</span>
                  </div>

                  {/* Comparison Action Buttons */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      onClick={() => setComparisonBefore(photo)}
                      className={`text-[10px] py-1 px-1.5 rounded font-semibold border transition ${
                        isBefore
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-800 text-rose-300 border-slate-700 hover:bg-rose-950/40'
                      }`}
                    >
                      {isBefore ? '✓ Is Before' : '+ Set Before'}
                    </button>
                    <button
                      onClick={() => setComparisonAfter(photo)}
                      className={`text-[10px] py-1 px-1.5 rounded font-semibold border transition ${
                        isAfter
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-slate-800 text-emerald-300 border-slate-700 hover:bg-emerald-950/40'
                      }`}
                    >
                      {isAfter ? '✓ Is After' : '+ Set After'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Modal */}
      {activeLightboxPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-5xl max-h-[95vh] flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <div>
                <h4 className="text-sm font-bold text-white">{activeLightboxPhoto.partName}</h4>
                <p className="text-xs text-slate-400">
                  {activeLightboxPhoto.wagonNumber} • {activeLightboxPhoto.category || activeLightboxPhoto.partCategory}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-lg text-xs text-slate-300">
                  <button
                    onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                    className="px-2 py-0.5 hover:bg-slate-700 rounded text-sm"
                  >
                    -
                  </button>
                  <span className="font-mono">{Math.round(zoomLevel * 100)}%</span>
                  <button
                    onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                    className="px-2 py-0.5 hover:bg-slate-700 rounded text-sm"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => {
                    setActiveLightboxPhoto(null);
                    setZoomLevel(1);
                  }}
                  className="text-slate-400 hover:text-white p-1 text-lg"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Image Viewer */}
            <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4 min-h-[60vh]">
              <img
                src={
                  activeLightboxPhoto.imageData ||
                  activeLightboxPhoto.imageBase64 ||
                  (activeLightboxPhoto as any).url
                }
                alt={activeLightboxPhoto.partName}
                style={{ transform: `scale(${zoomLevel})`, transition: 'transform 0.15s ease-out' }}
                className="max-h-[75vh] max-w-full object-contain cursor-grab"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
