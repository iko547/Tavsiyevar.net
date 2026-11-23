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
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [lightboxState, setLightboxState] = useState<{
    media: MediaItem;
    productTitle: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const seededOnceRef = useRef(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
    const handlePointerDownOutside = (event: PointerEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchDropdownOpen(false);
        setActiveSuggestionIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
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

  const brandDirectory = useMemo(() => {
    const map = new Map<string, { brand: string; normalized: string; count: number }>();
    recommendations.forEach((item) => {
      const firstToken = item.product.trim().split(/\s+/)[0] || '';
      const cleanBrand = firstToken.replace(/^[,.;:!?()]+|[,.;:!?()]+$/g, '');
      if (cleanBrand.length < 2) return;
      const key = normalizeTurkish(cleanBrand);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { brand: cleanBrand, normalized: key, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.brand.localeCompare(b.brand, 'tr-TR'),
    );
  }, [recommendations]);

  const locationDirectory = useMemo(() => {
    const map = new Map<string, { location: string; normalized: string; count: number }>();
    recommendations.forEach((item) => {
      if (!item.location) return;
      const cleanLoc = item.location.trim();
      if (cleanLoc.length < 2) return;
      const key = normalizeTurkish(cleanLoc);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { location: cleanLoc, normalized: key, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.location.localeCompare(b.location, 'tr-TR'),
    );
  }, [recommendations]);

  const searchSuggestions = useMemo(() => {
    const query = normalizeTurkish(searchTerm);

    const matchingBrands = query
      ? [
          ...brandDirectory.filter((b) => b.normalized.startsWith(query)),
          ...brandDirectory.filter(
            (b) => !b.normalized.startsWith(query) && b.normalized.includes(query),
          ),
        ]
      : brandDirectory;

    const matchingLocations = query
      ? [
          ...locationDirectory.filter((l) => l.normalized.startsWith(query)),
          ...locationDirectory.filter(
            (l) => !l.normalized.startsWith(query) && l.normalized.includes(query),
          ),
        ].slice(0, 6)
      : locationDirectory.slice(0, 6);

    const matchingProducts = query
      ? recommendations
          .filter(
            (item) =>
              normalizeTurkish(item.product).includes(query) ||
              normalizeTurkish(item.category).includes(query) ||
              normalizeTurkish(item.location || '').includes(query),
          )
          .slice(0, 6)
      : [];

    return {
      brands: query ? matchingBrands.slice(0, 12) : matchingBrands,
      locations: matchingLocations,
      products: matchingProducts,
    };
  }, [brandDirectory, locationDirectory, recommendations, searchTerm]);

  const flatSuggestions = useMemo(() => {
    const list: Array<
      | { kind: 'brand'; value: string; label: string; meta: string }
      | { kind: 'location'; value: string; label: string; meta: string }
      | { kind: 'product'; value: string; label: string; meta: string }
    > = [];
    searchSuggestions.brands.forEach((b) => {
      list.push({
        kind: 'brand',
        value: b.brand,
        label: b.brand,
        meta: `${b.count} kayıt`,
      });
    });
    searchSuggestions.locations.forEach((l) => {
      list.push({
        kind: 'location',
        value: l.location,
        label: l.location,
        meta: `${l.count} mekan`,
      });
    });
    searchSuggestions.products.forEach((item) => {
      list.push({
        kind: 'product',
        value: item.product,
        label: item.product,
        meta: item.location ? `${item.category} · ${item.location}` : item.category,
      });
    });
    return list;
  }, [searchSuggestions]);

  const filteredRecommendations = useMemo(() => {
    const query = normalizeTurkish(searchTerm);
    return recommendations.filter((item) => {
      const catOk = selectedCategory === 'Tümü' || item.category === selectedCategory;
      if (!catOk) return false;
      if (!query) return true;
      return (
        normalizeTurkish(item.product).includes(query) ||
        normalizeTurkish(item.location || '').includes(query) ||
        normalizeTurkish(item.note).includes(query) ||
        normalizeTurkish(item.category).includes(query)
      );
    });
  }, [recommendations, selectedCategory, searchTerm]);

  const handleSelectSuggestion = useCallback((value: string) => {
    setSearchTerm(value);
    setSelectedCategory('Tümü');
    setIsSearchDropdownOpen(false);
    setActiveSuggestionIndex(-1);
  }, []);

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
    setIsSearchDropdownOpen(false);
    setActiveSuggestionIndex(-1);
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
          className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)]"
          aria-label="Kategori ve arama filtreleri"
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div ref={searchContainerRef} className="relative w-full md:max-w-[440px]">
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
                ref={searchInputRef}
                type="text"
                inputMode="search"
                role="combobox"
                aria-expanded={
                  isSearchDropdownOpen && flatSuggestions.length > 0
                }
                aria-autocomplete="list"
                aria-controls="brand-search-listbox"
                aria-activedescendant={
                  activeSuggestionIndex >= 0
                    ? `search-option-${activeSuggestionIndex}`
                    : undefined
                }
                value={searchTerm}
                onFocus={() => setIsSearchDropdownOpen(true)}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setIsSearchDropdownOpen(true);
                  setActiveSuggestionIndex(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsSearchDropdownOpen(false);
                    setActiveSuggestionIndex(-1);
                  } else if (e.key === 'ArrowDown' && flatSuggestions.length > 0) {
                    e.preventDefault();
                    setIsSearchDropdownOpen(true);
                    setActiveSuggestionIndex((prev) =>
                      prev < flatSuggestions.length - 1 ? prev + 1 : 0,
                    );
                  } else if (e.key === 'ArrowUp' && flatSuggestions.length > 0) {
                    e.preventDefault();
                    setIsSearchDropdownOpen(true);
                    setActiveSuggestionIndex((prev) =>
                      prev > 0 ? prev - 1 : flatSuggestions.length - 1,
                    );
                  } else if (
                    e.key === 'Enter' &&
                    isSearchDropdownOpen &&
                    activeSuggestionIndex >= 0 &&
                    flatSuggestions[activeSuggestionIndex]
                  ) {
                    e.preventDefault();
                    handleSelectSuggestion(flatSuggestions[activeSuggestionIndex].value);
                  }
                }}
                placeholder="Marka, mekan, şehir veya deneyim ara..."
                aria-label="Marka, mekan, şehir veya deneyim ara"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50 py-[9px] pr-9 pl-[34px] text-[13.5px] text-slate-900 outline-none transition-colors focus:border-emerald-600 focus:bg-white"
              />
              {searchTerm.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setActiveSuggestionIndex(-1);
                    setIsSearchDropdownOpen(true);
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Aramayı temizle"
                  className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-base leading-none text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900"
                >
                  &times;
                </button>
              )}

              {isSearchDropdownOpen && flatSuggestions.length > 0 && (
                <div
                  id="brand-search-listbox"
                  role="listbox"
                  aria-label="Marka, şehir ve ürün önerileri"
                  className="absolute top-full right-0 left-0 z-30 mt-1.5 max-h-[290px] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-[0_14px_30px_-8px_rgba(15,23,42,0.16)]"
                >
                  {searchSuggestions.brands.length > 0 && (
                    <div>
                      <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold tracking-wide text-slate-500">
                        {searchTerm.trim() ? 'Marka & Mekanlar' : 'Tüm Marka & Mekanlar'}
                      </div>
                      {searchSuggestions.brands.map((brandItem, idx) => {
                        const isActiveOption = activeSuggestionIndex === idx;
                        return (
                          <button
                            key={brandItem.normalized}
                            id={`search-option-${idx}`}
                            type="button"
                            role="option"
                            aria-selected={isActiveOption}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectSuggestion(brandItem.brand)}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                              isActiveOption
                                ? 'bg-emerald-50 text-emerald-900'
                                : 'text-slate-800 hover:bg-slate-50'
                            }`}
                          >
                            <span className="font-semibold">{brandItem.brand}</span>
                            <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums">
                              {brandItem.count} kayıt
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchSuggestions.locations.length > 0 && (
                    <div
                      className={
                        searchSuggestions.brands.length > 0
                          ? 'mt-1 border-t border-slate-100 pt-1'
                          : ''
                      }
                    >
                      <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold tracking-wide text-slate-500">
                        Şehir / Konumlar
                      </div>
                      {searchSuggestions.locations.map((locItem, locIdx) => {
                        const optionIdx = searchSuggestions.brands.length + locIdx;
                        const isActiveOption = activeSuggestionIndex === optionIdx;
                        return (
                          <button
                            key={locItem.normalized}
                            id={`search-option-${optionIdx}`}
                            type="button"
                            role="option"
                            aria-selected={isActiveOption}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectSuggestion(locItem.location)}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                              isActiveOption
                                ? 'bg-emerald-50 text-emerald-900'
                                : 'text-slate-800 hover:bg-slate-50'
                            }`}
                          >
                            <span className="font-semibold">{locItem.location}</span>
                            <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums">
                              {locItem.count} mekan
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchSuggestions.products.length > 0 && (
                    <div
                      className={
                        searchSuggestions.brands.length > 0 ||
                        searchSuggestions.locations.length > 0
                          ? 'mt-1 border-t border-slate-100 pt-1'
                          : ''
                      }
                    >
                      <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold tracking-wide text-slate-500">
                        Ürün &amp; Mekanlar
                      </div>
                      {searchSuggestions.products.map((item, prodIdx) => {
                        const optionIdx =
                          searchSuggestions.brands.length +
                          searchSuggestions.locations.length +
                          prodIdx;
                        const isActiveOption = activeSuggestionIndex === optionIdx;
                        return (
                          <button
                            key={item.id}
                            id={`search-option-${optionIdx}`}
                            type="button"
                            role="option"
                            aria-selected={isActiveOption}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectSuggestion(item.product)}
                            className={`flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left transition-colors ${
                              isActiveOption
                                ? 'bg-emerald-50 text-emerald-900'
                                : 'text-slate-800 hover:bg-slate-50'
                            }`}
                          >
                            <span className="truncate text-[13px] font-semibold">
                              {item.product}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500">
                              {item.location
                                ? `${item.category} · ${item.location}`
                                : item.category}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs font-semibold text-slate-500 tabular-nums">
              <span>{filteredRecommendations.length} tavsiye</span>
              {(selectedCategory !== 'Tümü' || searchTerm.trim().length > 0) && (
                <button
                  type="button"
                  onClick={() => handleResetFilters()}
                  className="cursor-pointer font-semibold text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  Filtreyi sıfırla
                </button>
              )}
            </div>
          </div>

          <div className="no-scrollbar flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible md:pb-0">
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
