import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddRecommendationModal } from './components/AddRecommendationModal';
import { BrandEmblem } from './components/BrandEmblem';
import { MediaLightbox } from './components/MediaLightbox';
import { RecommendationCard } from './components/RecommendationCard';
import { CATEGORY_FILTERS, INITIAL_RECOMMENDATIONS } from './data/initialRecommendations';
import { auth, googleProvider } from './firebase';
import { CategoryFilter, MediaItem, Recommendation } from './types/recommendation';
import {
  cleanupRemovedRecommendationsIfAuthorized,
  CreateRecommendationInput,
  createRecommendationInFirestore,
  deleteRecommendationInFirestore,
  loadGuestVotes,
  normalizeTurkish,
  saveGuestVote,
  seedInitialRecommendationsIfEmpty,
  submitVoteInFirestore,
  subscribePublicRecommendations,
  subscribeUserVotes,
} from './utils/storage';

const ADMIN_EMAIL = 'yorganciyonca@gmail.com';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreItems, setFirestoreItems] = useState<Recommendation[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const [guestVotes, setGuestVotes] = useState<Record<string, number>>(() => loadGuestVotes());
  const [votingIds, setVotingIds] = useState<Record<string, boolean>>({});
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('Tümü');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [lightboxState, setLightboxState] = useState<{
    media: MediaItem;
    productTitle: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const seededOnceRef = useRef(false);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser && currentUser.emailVerified) {
        void cleanupRemovedRecommendationsIfAuthorized();
      } else {
        setUserVotes({});
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    const unsubRecs = subscribePublicRecommendations(
      (items) => {
        setFirestoreItems(items);
        setIsLoadingItems(false);
      },
      () => {
        setIsLoadingItems(false);
        showToast('Veritabanından veriler okunurken bağlantı sorunu oluştu');
      },
    );
    return () => unsubRecs();
  }, [showToast]);

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified || seededOnceRef.current) return;
    if (!isLoadingItems && firestoreItems.length === 0) {
      seededOnceRef.current = true;
      void seedInitialRecommendationsIfEmpty(user).catch(() => {
        seededOnceRef.current = false;
      });
    }
  }, [authReady, user, isLoadingItems, firestoreItems.length]);

  useEffect(() => {
    if (!user) return;
    const unsubVotes = subscribeUserVotes(
      user.uid,
      (votes) => setUserVotes(votes),
      () => {
        // Votes read failure is logged by handleFirestoreError
      },
    );
    return () => unsubVotes();
  }, [user]);

  const recommendations = useMemo(() => {
    const baseList: Recommendation[] =
      firestoreItems.length > 0
        ? firestoreItems
        : INITIAL_RECOMMENDATIONS.map((item) => ({ ...item, isSeedPreview: true }));

    return baseList.map((item) => ({
      ...item,
      userRating: userVotes[item.id] ?? guestVotes[item.id] ?? 0,
    }));
  }, [firestoreItems, userVotes, guestVotes]);

  const filteredRecommendations = useMemo(() => {
    const query = normalizeTurkish(searchTerm);
    return recommendations.filter((item) => {
      const catOk = selectedCategory === 'Tümü' || item.category === selectedCategory;
      if (!catOk) return false;
      if (!query) return true;
      return (
        normalizeTurkish(item.product).includes(query) ||
        normalizeTurkish(item.note).includes(query) ||
        normalizeTurkish(item.category).includes(query)
      );
    });
  }, [recommendations, selectedCategory, searchTerm]);

  const handleSignIn = useCallback(async (): Promise<User | null> => {
    setIsSigningIn(true);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      showToast('Google hesabınla giriş yapıldı');
      return credential.user;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        showToast('Giriş penceresi kapatıldı');
      } else if (code === 'auth/popup-blocked') {
        showToast('Tarayıcı açılır pencereyi engelledi, lütfen izin verin');
      } else {
        showToast('Giriş yapılamadı, lütfen tekrar deneyin');
      }
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, [showToast]);

  const handleSignOut = async () => {
    await signOut(auth);
    showToast('Çıkış yapıldı');
  };

  const handleResetFilters = (e?: MouseEvent<HTMLAnchorElement>) => {
    if (e) e.preventDefault();
    setSelectedCategory('Tümü');
    setSearchTerm('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVote = async (itemId: string, score: number) => {
    if (votingIds[itemId]) return;
    const prevScore = userVotes[itemId] ?? guestVotes[itemId] ?? 0;

    setVotingIds((prev) => ({ ...prev, [itemId]: true }));
    try {
      await submitVoteInFirestore(itemId, score, prevScore, user);
      setGuestVotes(saveGuestVote(itemId, score));
      showToast(`${score}/5 puanın veritabanına kaydedildi`);
    } catch {
      showToast('Puan kaydedilemedi, lütfen tekrar deneyin');
    } finally {
      setVotingIds((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  };

  const handleAddRecommendation = async (input: CreateRecommendationInput) => {
    if (!user) return;
    await createRecommendationInFirestore(input, user);
    setSelectedCategory('Tümü');
    setSearchTerm('');
    showToast('Tavsiyen canlı veritabanına kaydedildi');
  };

  const handleDeleteRecommendation = async (recId: string) => {
    await deleteRecommendationInFirestore(recId);
    showToast('Tavsiye veritabanından silindi');
  };

  const closeAddModal = useCallback(() => setIsAddModalOpen(false), []);
  const closeLightbox = useCallback(() => setLightboxState(null), []);

  const isCurrentUserAdmin = Boolean(
    user?.emailVerified && user.email === ADMIN_EMAIL,
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Üst Menü Barı */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1120px] flex-nowrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <a
            href="#top"
            onClick={handleResetFilters}
            className="inline-flex shrink-0 items-center gap-1.5 text-slate-900 no-underline sm:gap-2.5"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-slate-200 bg-white shadow-xs min-[360px]:h-8 min-[360px]:w-8 min-[360px]:rounded-[10px] sm:h-10 sm:w-10 sm:rounded-xl"
              aria-hidden="true"
            >
              <BrandEmblem lit size={20} className="min-[360px]:h-[22px] min-[360px]:w-[22px] sm:h-7 sm:w-7" />
            </span>
            <span className="inline-flex items-baseline whitespace-nowrap font-[family-name:var(--font-brand)] text-[15px] font-extrabold tracking-[-0.025em] text-[#0e6167] min-[360px]:text-[17px] sm:text-[23px]">
              tavsiyevar<span className="text-amber-600">.net</span>
            </span>
          </a>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {authReady && (
              user ? (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="hidden max-w-[140px] truncate text-xs font-semibold text-slate-600 md:inline">
                    {user.displayName || user.email}
                  </span>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-[10px] border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:rounded-[11px] sm:px-3 sm:py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    Çıkış
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isSigningIn}
                  onClick={() => void handleSignIn()}
                  className="inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[10px] border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-60 sm:rounded-[11px] sm:px-3.5 sm:py-2.5 sm:text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {isSigningIn ? (
                    'Giriş...'
                  ) : (
                    <>
                      <span className="min-[390px]:hidden">Giriş</span>
                      <span className="hidden min-[390px]:inline">Giriş Yap</span>
                    </>
                  )}
                </button>
              )
            )}

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[10px] bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs transition-all duration-150 hover:bg-emerald-700 active:scale-[0.97] sm:gap-1.5 sm:rounded-[11px] sm:px-4 sm:py-2.5 sm:text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                aria-hidden="true"
                className="sm:h-4 sm:w-4"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Tavsiye Ekle</span>
            </button>
          </div>
        </div>
      </header>

      {/* Ana İçerik */}
      <main id="top" className="mx-auto max-w-[1120px] px-4 pt-5 pb-16">
        {/* Alt Başlık ve Fiyat/Performans Rozeti */}
        <section className="mb-[18px] flex flex-col items-start gap-2.5 rounded-2xl border border-slate-200 bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-bold text-emerald-700">
            <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden="true">
              <BrandEmblem lit size={21} />
            </span>
            <span>Fiyat / Performans &amp; Gerçek Deneyim Odaklı</span>
          </div>
          <p className="max-w-[680px] text-[15px] font-medium text-slate-600">
            Gerçek kullanıcı deneyimlerine dayalı, doğrulanmış fiyat/performans tavsiyeleri.
          </p>
        </section>

        {/* Kategori Filtreleri ve Arama */}
        <section
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-[13px] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)]"
          aria-label="Kategori ve arama filtreleri"
        >
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
            {CATEGORY_FILTERS.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  aria-pressed={isActive}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-[10px] border px-[13px] py-[7px] text-[12.5px] font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                    isActive
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-600 hover:text-emerald-700'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          <div className="relative w-full min-w-[230px] flex-1 md:max-w-[340px]">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-slate-500"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Marka, model veya deneyim ara..."
              aria-label="Marka, model veya deneyim ara"
              className="w-full rounded-[10px] border border-slate-200 bg-slate-50 py-[8.5px] pr-3 pl-[34px] text-[13px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
            />
          </div>
        </section>

        {/* Tavsiye Kartları Izgarası */}
        {isLoadingItems ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-52 animate-pulse rounded-2xl border border-slate-200 bg-white p-[18px]"
              />
            ))}
          </section>
        ) : filteredRecommendations.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-live="polite">
            {filteredRecommendations.map((item) => {
              const canDelete = Boolean(
                !item.isSeedPreview &&
                  user &&
                  (item.authorId === user.uid || isCurrentUserAdmin),
              );
              return (
                <RecommendationCard
                  key={item.id}
                  item={item}
                  canDelete={canDelete}
                  isVoting={Boolean(votingIds[item.id])}
                  onVote={handleVote}
                  onDelete={handleDeleteRecommendation}
                  onOpenMedia={(media, productTitle) =>
                    setLightboxState({ media, productTitle })
                  }
                />
              );
            })}
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white px-5 py-9 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h3 className="mb-1.5 text-base font-bold text-slate-900">
              Aradığın kriterde tavsiye bulunamadı
            </h3>
            <p className="mb-3.5 text-[13.5px] text-slate-500">
              Farklı bir marka veya model yazabilir ya da tüm kategorileri görüntüleyebilirsin.
            </p>
            <button
              type="button"
              onClick={() => handleResetFilters()}
              className="inline-flex cursor-pointer items-center justify-center rounded-[11px] bg-emerald-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-xs transition-colors hover:bg-emerald-700"
            >
              Tüm Tavsiyeleri Göster
            </button>
          </section>
        )}
      </main>

      {/* Yeni Tavsiye Ekle Modalı */}
      <AddRecommendationModal
        isOpen={isAddModalOpen}
        user={user}
        onSignIn={handleSignIn}
        onClose={closeAddModal}
        onAdd={handleAddRecommendation}
        onNotify={showToast}
      />

      {/* Medya Büyütme (Lightbox) Penceresi */}
      <MediaLightbox
        media={lightboxState?.media ?? null}
        productTitle={lightboxState?.productTitle ?? ''}
        onClose={closeLightbox}
      />

      {/* Toast Bildirim Kutusu */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed right-5 bottom-5 z-[70] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-[11px] text-[13px] font-medium text-white shadow-[0_20px_35px_-10px_rgba(15,23,42,0.2)] transition-all duration-200 ${
          toastMessage ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
        <span>{toastMessage ?? ''}</span>
      </div>
    </div>
  );
}
