import { User } from 'firebase/auth';
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES } from '../data/initialRecommendations';
import { Category, MediaItem } from '../types/recommendation';
import { CreateRecommendationInput, fileToMediaItem, MAX_MEDIA_ITEMS } from '../utils/storage';
import { BrandEmblem } from './BrandEmblem';

interface AddRecommendationModalProps {
  isOpen: boolean;
  user: User | null;
  onSignIn: () => Promise<User | null>;
  onClose: () => void;
  onAdd: (input: CreateRecommendationInput) => Promise<void>;
  onNotify: (message: string) => void;
}

interface CategorySuggestion {
  category: Category;
  reason: string;
}

export function AddRecommendationModal({
  isOpen,
  user,
  onSignIn,
  onClose,
  onAdd,
  onNotify,
}: AddRecommendationModalProps) {
  const [product, setProduct] = useState('');
  const [category, setCategory] = useState<Category>('Ev Aletleri');
  const [location, setLocation] = useState('');
  const [duration, setDuration] = useState('');
  const [note, setNote] = useState('');
  const [stagedMedia, setStagedMedia] = useState<MediaItem[]>([]);
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [hasManualCategory, setHasManualCategory] = useState(false);
  const [isAnalyzingCategory, setIsAnalyzingCategory] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<CategorySuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const hasManualCategoryRef = useRef(false);
  const lastAnalyzedKeyRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    hasManualCategoryRef.current = hasManualCategory;
  }, [hasManualCategory]);

  const resetFormState = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    lastAnalyzedKeyRef.current = '';
    hasManualCategoryRef.current = false;
    setProduct('');
    setCategory('Ev Aletleri');
    setLocation('');
    setDuration('');
    setNote('');
    setStagedMedia([]);
    setHasManualCategory(false);
    setIsAnalyzingCategory(false);
    setAiSuggestion(null);
    setAiError(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;
    resetFormState();
    onClose();
  }, [isSubmitting, onClose, resetFormState]);

  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      categorySelectRef.current?.focus();
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        resetFormState();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, isSubmitting, onClose, resetFormState]);

  const requestCategorySuggestion = useCallback(
    async (
      currentProduct: string,
      currentNote: string,
      forceApply: boolean,
    ) => {
      const trimmedProd = currentProduct.trim();
      const trimmedNote = currentNote.trim();
      if (trimmedNote.length < 3 && trimmedProd.length < 2) {
        if (forceApply) {
          setAiError('Öneri alabilmek için önce ürün/mekan adı veya kısa yorum yazın.');
        }
        return;
      }

      const key = `${trimmedProd}::${trimmedNote}`;
      if (!forceApply && key === lastAnalyzedKeyRef.current) {
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsAnalyzingCategory(true);
      if (forceApply) {
        setAiError(null);
      }

      try {
        const res = await fetch('/api/suggest-category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product: trimmedProd,
            note: trimmedNote,
          }),
          signal: controller.signal,
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          if (forceApply) {
            setAiError('Otomatik kategori servisi şu anda yanıt vermiyor, listeden seçebilirsiniz.');
          }
          return;
        }

        const data = (await res.json().catch(() => ({}))) as {
          category?: unknown;
          reason?: unknown;
          error?: unknown;
        };

        if (!res.ok) {
          const msg =
            typeof data.error === 'string' && data.error.trim().length > 0
              ? data.error.trim()
              : 'Kategori analizi şu anda yapılamadı.';
          setAiError(msg);
          return;
        }

        const matchedCategory = CATEGORIES.find((c) => c === data.category);
        if (!matchedCategory) {
          setAiError('Uygun kategori önerisi alınamadı.');
          return;
        }

        lastAnalyzedKeyRef.current = key;
        const reasonText =
          typeof data.reason === 'string' && data.reason.trim().length > 0
            ? data.reason.trim()
            : 'Yorumuna göre önerildi';

        setAiError(null);
        setAiSuggestion({ category: matchedCategory, reason: reasonText });

        if (forceApply || !hasManualCategoryRef.current) {
          setCategory(matchedCategory);
          if (forceApply) {
            setHasManualCategory(false);
            hasManualCategoryRef.current = false;
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        if (forceApply) {
          setAiError('Kategori analiz servisine ulaşılamadı, listeden seçebilirsiniz.');
        }
      } finally {
        if (abortControllerRef.current === controller) {
          setIsAnalyzingCategory(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    const trimmedNote = note.trim();
    const trimmedProduct = product.trim();

    const enoughForAuto =
      trimmedNote.length >= 6 || trimmedProduct.length >= 4;

    if (!enoughForAuto) return;

    const timer = window.setTimeout(() => {
      void requestCategorySuggestion(trimmedProduct, trimmedNote, false);
    }, 650);

    return () => window.clearTimeout(timer);
  }, [isOpen, note, product, requestCategorySuggestion]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleMediaUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const remainingSlots = MAX_MEDIA_ITEMS - stagedMedia.length;
    if (remainingSlots <= 0) {
      onNotify(`En fazla ${MAX_MEDIA_ITEMS} adet medya ekleyebilirsiniz`);
      return;
    }

    const selected = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      onNotify(`En fazla ${MAX_MEDIA_ITEMS} adet medya yüklenebilir`);
    }

    setIsProcessingMedia(true);
    try {
      const results = await Promise.all(selected.map((file) => fileToMediaItem(file)));
      const valid: MediaItem[] = [];
      let firstError: string | undefined;

      results.forEach((res) => {
        if (res.item) {
          valid.push(res.item);
        } else if (!firstError && res.error) {
          firstError = res.error;
        }
      });

      if (valid.length > 0) {
        setStagedMedia((prev) => [...prev, ...valid].slice(0, MAX_MEDIA_ITEMS));
      }
      if (firstError) {
        onNotify(firstError);
      }
    } finally {
      setIsProcessingMedia(false);
    }
  };

  const handleRemoveStagedMedia = (mediaId: string) => {
    setStagedMedia((prev) => prev.filter((m) => m.id !== mediaId));
  };

  const handleSignInClick = async () => {
    setIsSigningIn(true);
    try {
      await onSignIn();
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedProduct = product.trim();
    const trimmedLocation = location.trim();
    const trimmedDuration = duration.trim();
    const trimmedNote = note.trim();
    const isVenue = category === 'Yemek & Mekan';

    if (trimmedProduct.length < 2 || trimmedDuration.length < 1 || trimmedNote.length < 5) {
      onNotify('Lütfen isim, süre ve en az 5 karakter deneyim notu girin');
      return;
    }

    if (isVenue && trimmedLocation.length < 2) {
      onNotify('Lütfen mekanın bulunduğu ili girin');
      return;
    }

    let activeUser = user;
    if (!activeUser) {
      setIsSigningIn(true);
      try {
        activeUser = await onSignIn();
      } finally {
        setIsSigningIn(false);
      }
      if (!activeUser) return;
    }

    const durationText =
      isVenue || trimmedDuration.toLocaleLowerCase('tr-TR').includes('kullanım')
        ? trimmedDuration
        : `${trimmedDuration} kullanımda`;

    setIsSubmitting(true);
    try {
      await onAdd({
        product: trimmedProduct,
        category,
        location: isVenue ? trimmedLocation : undefined,
        duration: durationText,
        note: trimmedNote,
        media: [...stagedMedia],
      });
      resetFormState();
      onClose();
    } catch {
      onNotify('Tavsiye kaydedilirken bir hata oluştu, lütfen tekrar deneyin');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modalHeading"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div className="max-h-[90vh] w-full max-w-[540px] overflow-y-auto rounded-[18px] border border-slate-200 bg-white shadow-[0_20px_35px_-10px_rgba(15,23,42,0.2)]">
        <div className="sticky top-0 z-[5] flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BrandEmblem lit size={23} />
            <h2 id="modalHeading" className="text-[17px] font-bold text-slate-900">
              + Yeni Tavsiye Ekle
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            aria-label="Kapat"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] border border-slate-200 bg-slate-50 text-lg leading-none text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-[15px] p-5">
          {!user && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
              <p className="text-xs font-medium text-amber-900">
                Tavsiyenin canlı veritabanına kaydedilmesi için Google ile giriş yapmalısın.
              </p>
              <button
                type="button"
                disabled={isSigningIn}
                onClick={handleSignInClick}
                className="shrink-0 cursor-pointer whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                {isSigningIn ? 'Giriş yapılıyor...' : 'Google ile Giriş Yap'}
              </button>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="inputCategory" className="text-[12.5px] font-semibold text-slate-900">
                Kategori *
              </label>
              <button
                type="button"
                disabled={isAnalyzingCategory}
                onClick={() => void requestCategorySuggestion(product, note, true)}
                className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path d="M12 3l1.9 5.8L20 10.7l-5 3.8 1.9 6L12 17l-4.9 3.5 1.9-6-5-3.8 6.1-1.9L12 3z" />
                </svg>
                <span>{isAnalyzingCategory ? 'Analiz ediliyor...' : 'Yorumdan Otomatik Öner'}</span>
              </button>
            </div>

            <select
              ref={categorySelectRef}
              id="inputCategory"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as Category);
                setHasManualCategory(true);
                hasManualCategoryRef.current = true;
              }}
              className="w-full rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {isAnalyzingCategory && (
              <p className="mt-1.5 text-[11.5px] font-medium text-emerald-700" role="status">
                Yapay zeka yorumunu analiz edip en uygun kategoriyi arıyor...
              </p>
            )}

            {!isAnalyzingCategory && aiSuggestion && (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11.5px]">
                {category === aiSuggestion.category ? (
                  <span className="font-medium text-emerald-900">
                    Yapay zeka önerisi seçildi:{' '}
                    <strong className="font-bold">{aiSuggestion.category}</strong>{' '}
                    <span className="text-emerald-700">({aiSuggestion.reason})</span> — İstersen
                    listeden değiştirebilirsin.
                  </span>
                ) : (
                  <>
                    <span className="font-medium text-slate-700">
                      Yapay zeka önerisi:{' '}
                      <strong className="font-bold text-slate-900">{aiSuggestion.category}</strong>{' '}
                      <span className="text-slate-500">({aiSuggestion.reason})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCategory(aiSuggestion.category);
                        setHasManualCategory(false);
                        hasManualCategoryRef.current = false;
                      }}
                      className="cursor-pointer whitespace-nowrap rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                    >
                      Öneriyi Uygula
                    </button>
                  </>
                )}
              </div>
            )}

            {!isAnalyzingCategory && aiError && (
              <p className="mt-1.5 text-[11.5px] font-medium text-amber-800">{aiError}</p>
            )}
          </div>

          <div>
            <label htmlFor="inputProduct" className="mb-1.5 block text-[12.5px] font-semibold text-slate-900">
              {category === 'Yemek & Mekan' ? 'Mekan / Restoran Adı *' : 'Ürün & Marka / Model *'}
            </label>
            <input
              type="text"
              id="inputProduct"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              minLength={2}
              maxLength={180}
              required
              placeholder={
                category === 'Yemek & Mekan'
                  ? 'Örn: Beyzade Kebap Salonu'
                  : 'Örn: Vestel Lodos H6000 K Torbasız Elektrikli Süpürge'
              }
              className="w-full rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
            />
          </div>

          <div className={category === 'Yemek & Mekan' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : ''}>
            {category === 'Yemek & Mekan' && (
              <div>
                <label htmlFor="inputLocation" className="mb-1.5 block text-[12.5px] font-semibold text-slate-900">
                  İl (Şehir) *
                </label>
                <input
                  type="text"
                  id="inputLocation"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  minLength={2}
                  maxLength={100}
                  required
                  placeholder="Örn: Adana"
                  className="w-full rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
                />
              </div>
            )}

            <div>
              <label htmlFor="inputDuration" className="mb-1.5 block text-[12.5px] font-semibold text-slate-900">
                {category === 'Yemek & Mekan' ? 'Ziyaret Sıklığı / Süresi *' : 'Kullanım Süresi *'}
              </label>
              <input
                type="text"
                id="inputDuration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                minLength={1}
                maxLength={60}
                required
                placeholder={category === 'Yemek & Mekan' ? 'Örn: 2 yıldır müdavimiyim' : 'Örn: 6 ay'}
                className="w-full rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="inputNote" className="mb-1.5 block text-[12.5px] font-semibold text-slate-900">
              Tavsiye Notu / Deneyiminiz *
            </label>
            <textarea
              id="inputNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minLength={5}
              maxLength={2000}
              required
              placeholder={
                category === 'Yemek & Mekan'
                  ? 'Lezzet, porsiyon, hijyen ve fiyat/performans deneyimini paylaş... (Yazdıkça kategori otomatik önerilir)'
                  : 'Ürünün günlük kullanımdaki gerçek performansını ve fiyat/performans deneyimini paylaş... (Yazdıkça kategori otomatik önerilir)'
              }
              className="min-h-[92px] w-full resize-y rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
            />
            {(isAnalyzingCategory || aiSuggestion) && (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                {isAnalyzingCategory ? (
                  <span className="font-medium text-emerald-700">
                    Yapay zeka uygun kategoriyi analiz ediyor...
                  </span>
                ) : aiSuggestion ? (
                  <span className="font-medium text-slate-600">
                    Otomatik kategori:{' '}
                    <strong className="font-bold text-emerald-800">{category}</strong>
                    {category !== aiSuggestion.category && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => {
                            setCategory(aiSuggestion.category);
                            setHasManualCategory(false);
                            hasManualCategoryRef.current = false;
                          }}
                          className="cursor-pointer font-bold text-emerald-700 underline hover:text-emerald-900"
                        >
                          Öneriyi uygula ({aiSuggestion.category})
                        </button>
                      </>
                    )}
                  </span>
                ) : null}
              </div>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-900">
              Fotoğraf veya Video Ekle (En fazla {MAX_MEDIA_ITEMS} dosya, isteğe bağlı)
            </span>
            <label
              htmlFor="inputMedia"
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition-colors hover:border-emerald-600 hover:bg-emerald-50"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-slate-200 bg-white text-emerald-600"
                aria-hidden="true"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </span>
              <span className="text-[13px] font-semibold text-slate-900">
                {isProcessingMedia ? 'Medya hazırlanıyor...' : 'Fotoğraf veya Video Seç'}
              </span>
              <span className="text-[11.5px] text-slate-500">
                Fotoğraflar otomatik optimize edilerek veritabanına kalıcı kaydedilir
              </span>
            </label>
            <input
              type="file"
              id="inputMedia"
              accept="image/*,video/*"
              multiple
              onChange={handleMediaUpload}
              className="hidden"
            />

            {stagedMedia.length > 0 && (
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {stagedMedia.map((media) => (
                  <div
                    key={media.id}
                    className="relative overflow-hidden rounded-[10px] border border-slate-200 bg-white"
                  >
                    {media.type === 'video' ? (
                      <video
                        src={media.url}
                        muted
                        playsInline
                        className="block h-20 w-full bg-slate-900 object-cover"
                      />
                    ) : (
                      <img
                        src={media.url}
                        alt={media.name}
                        referrerPolicy="no-referrer"
                        className="block h-20 w-full bg-slate-900 object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveStagedMedia(media.id)}
                      aria-label={`${media.name} medyasını kaldır`}
                      className="absolute top-1 right-1 flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full bg-slate-900/85 text-[13px] font-bold text-white transition-colors hover:bg-red-600"
                    >
                      &times;
                    </button>
                    <div className="truncate border-t border-slate-200 px-1.5 py-1 text-[10.5px] text-slate-600">
                      {media.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleCancel}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[11px] border border-slate-200 bg-white px-3.5 py-[9px] text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isProcessingMedia || isSubmitting || isSigningIn}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[11px] bg-emerald-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Yayınlanıyor...' : 'Tavsiyeyi Yayınla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

