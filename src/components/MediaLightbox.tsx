import { useEffect } from 'react';
import { MediaItem } from '../types/recommendation';

interface MediaLightboxProps {
  media: MediaItem | null;
  productTitle: string;
  onClose: () => void;
}

export function MediaLightbox({ media, productTitle, onClose }: MediaLightboxProps) {
  useEffect(() => {
    if (!media) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [media, onClose]);

  if (!media) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/90 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${productTitle} medya önizlemesi`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative max-h-[88vh] max-w-[90vw] overflow-hidden rounded-[14px] bg-slate-900 shadow-[0_20px_35px_-10px_rgba(15,23,42,0.35)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Önizlemeyi kapat"
          className="absolute top-3 right-3 z-[2] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-slate-900/80 text-xl text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          &times;
        </button>

        {media.type === 'video' ? (
          <video
            src={media.url}
            controls
            autoPlay
            playsInline
            className="block max-h-[85vh] max-w-[90vw] object-contain"
          />
        ) : (
          <img
            src={media.url}
            alt={productTitle}
            referrerPolicy="no-referrer"
            className="block max-h-[85vh] max-w-[90vw] object-contain"
          />
        )}
      </div>
    </div>
  );
}
