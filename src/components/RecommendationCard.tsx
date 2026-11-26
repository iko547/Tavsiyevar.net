import { User } from 'firebase/auth';
import { FormEvent, useEffect, useState } from 'react';
import {
  MediaItem,
  Recommendation,
  RecommendationComment,
} from '../types/recommendation';
import {
  createCommentInFirestore,
  deleteCommentInFirestore,
  subscribeRecommendationComments,
} from '../utils/storage';
import { BrandEmblem } from './BrandEmblem';

interface RecommendationCardProps {
  item: Recommendation;
  currentUser: User | null;
  isAdmin?: boolean;
  canDelete?: boolean;
  isVoting?: boolean;
  isHighlighted?: boolean;
  onVote: (itemId: string, score: number) => void;
  onDelete?: (itemId: string) => Promise<void> | void;
  onOpenMedia: (media: MediaItem, productTitle: string) => void;
  onSignIn: () => Promise<User | null>;
  onShare: (item: Recommendation) => void;
  onNotify: (message: string) => void;
}

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatCommentDate(ms: number): string {
  if (!ms) return 'Az önce';
  try {
    return SHORT_DATE_FORMATTER.format(new Date(ms));
  } catch {
    return '';
  }
}

export function RecommendationCard({
  item,
  currentUser,
  isAdmin = false,
  canDelete = false,
  isVoting = false,
  isHighlighted = false,
  onVote,
  onDelete,
  onOpenMedia,
  onSignIn,
  onShare,
  onNotify,
}: RecommendationCardProps) {
  const [hoverScore, setHoverScore] = useState<number | null>(null);
  const [failedMediaIds, setFailedMediaIds] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [comments, setComments] = useState<RecommendationComment[]>([]);
  const [hasLoadedComments, setHasLoadedComments] = useState(false);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [confirmCommentDeleteId, setConfirmCommentDeleteId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  useEffect(() => {
    if (!isCommentsOpen || item.isSeedPreview) return;

    setIsLoadingComments(true);
    const unsubscribe = subscribeRecommendationComments(
      item.id,
      (list) => {
        setComments(list);
        setHasLoadedComments(true);
        setIsLoadingComments(false);
      },
      () => {
        setIsLoadingComments(false);
        onNotify('Yorumlar yüklenirken bağlantı sorunu oluştu');
      },
    );

    return () => unsubscribe();
  }, [isCommentsOpen, item.id, item.isSeedPreview, onNotify]);

  const avg = item.ratingCount > 0 ? (item.ratingSum / item.ratingCount).toFixed(1) : '0.0';
  const activeRating = hoverScore ?? item.userRating ?? 0;
  const visibleMedia = (item.media || []).filter((m) => !failedMediaIds[m.id]);

  const handleConfirmDelete = async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(item.id);
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleSubmitComment = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (trimmed.length < 3 || isSubmittingComment || item.isSeedPreview) return;

    const activeUser = currentUser ?? (await onSignIn());
    if (!activeUser) return;
    if (!activeUser.emailVerified) {
      onNotify('Yorum eklemek için doğrulanmış Google hesabı gerekir');
      return;
    }

    setIsSubmittingComment(true);
    try {
      await createCommentInFirestore(item.id, trimmed, activeUser);
      setCommentText('');
      onNotify('Deneyim notun eklendi');
    } catch {
      onNotify('Yorum kaydedilemedi, lütfen tekrar deneyin');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (deletingCommentId) return;
    setDeletingCommentId(commentId);
    try {
      await deleteCommentInFirestore(item.id, commentId);
      setConfirmCommentDeleteId(null);
      onNotify('Yorum silindi');
    } catch {
      onNotify('Yorum silinemedi, lütfen tekrar deneyin');
    } finally {
      setDeletingCommentId(null);
    }
  };

  return (
    <article
      className={`flex flex-col justify-between rounded-2xl border bg-white p-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-200 hover:shadow-[0_10px_25px_-5px_rgba(15,23,42,0.08),0_4px_10px_-2px_rgba(15,23,42,0.04)] ${
        isHighlighted
          ? 'border-emerald-400 ring-2 ring-emerald-500/35'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-[7px] border border-emerald-200 bg-emerald-50 px-2.5 py-[3px] text-[11px] font-bold text-emerald-700">
              {item.category}
            </span>
            <span className="rounded-[7px] border border-slate-200 bg-slate-50 px-2.5 py-[3px] text-[11px] font-semibold text-slate-600">
              {item.duration}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-[3px] text-xs font-bold text-slate-900 tabular-nums"
              title="Topluluk ortalama puanı"
            >
              <BrandEmblem lit size={14} />
              <span>{avg}</span>
              <span className="text-[11px] font-medium text-slate-500">({item.ratingCount} oy)</span>
            </div>

            {canDelete && onDelete && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label={`${item.product} tavsiyesini sil`}
                className="cursor-pointer rounded-[7px] border border-slate-200 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                Sil
              </button>
            )}

            {canDelete && onDelete && confirmDelete && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="cursor-pointer rounded-[7px] bg-red-600 px-2 py-[3px] text-[11px] font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  {isDeleting ? 'Siliniyor' : 'Onayla'}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setConfirmDelete(false)}
                  className="cursor-pointer rounded-[7px] border border-slate-200 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                >
                  İptal
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mb-2.5 flex items-start gap-2.5">
          <span
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-emerald-200 bg-emerald-50"
            aria-hidden="true"
          >
            <BrandEmblem lit size={14} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base leading-[1.35] font-bold tracking-[-0.01em] text-slate-900">
              {item.product}
            </h2>
            {(item.location || (item.authorName && item.authorName !== 'tavsiyevar.net')) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {item.location && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-[3px] text-[12px] font-bold text-amber-900"
                    title={`Konum: ${item.location}`}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                      className="shrink-0"
                    >
                      <path
                        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z"
                        fill="#d97706"
                      />
                      <circle cx="12" cy="9" r="2.75" fill="#fffbeb" />
                    </svg>
                    <span>{item.location}</span>
                  </span>
                )}
                {item.authorName && item.authorName !== 'tavsiyevar.net' && (
                  <span className="text-[11.5px] font-medium text-slate-500">
                    Paylaşan: {item.authorName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-sm leading-[1.58] text-slate-600">{item.note}</p>

        {visibleMedia.length > 0 && (
          <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            {visibleMedia.map((media) => (
              <button
                key={media.id}
                type="button"
                onClick={() => onOpenMedia(media, item.product)}
                className="group relative h-40 w-full cursor-pointer overflow-hidden rounded-[11px] border border-slate-200 bg-slate-50 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                aria-label={`${item.product} medyasını büyüt`}
              >
                {media.type === 'video' ? (
                  <video
                    muted
                    playsInline
                    preload="metadata"
                    src={media.url}
                    onError={() => setFailedMediaIds((prev) => ({ ...prev, [media.id]: true }))}
                    className="block h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                ) : (
                  <img
                    src={media.url}
                    alt={item.product}
                    referrerPolicy="no-referrer"
                    onError={() => setFailedMediaIds((prev) => ({ ...prev, [media.id]: true }))}
                    className="block h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                )}
                <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded-md bg-slate-900/75 px-2 py-0.5 text-[10.5px] font-semibold text-white">
                  {media.type === 'video' ? 'Video' : 'Büyüt'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className="inline-flex items-center gap-1.5"
              onMouseLeave={() => setHoverScore(null)}
              role="group"
              aria-label={`${item.product} için 1-5 arası puanlama`}
            >
              {[1, 2, 3, 4, 5].map((score) => {
                const isLit = score <= activeRating;
                return (
                  <button
                    key={score}
                    type="button"
                    disabled={isVoting}
                    onClick={() => {
                      setHoverScore(null);
                      onVote(item.id, score);
                    }}
                    onMouseEnter={() => setHoverScore(score)}
                    aria-label={`${score} puan ver`}
                    aria-pressed={item.userRating === score}
                    title={`${score} / 5`}
                    className={`inline-flex h-7 w-7 flex-[0_0_28px] cursor-pointer items-center justify-center rounded-[7px] border p-0 transition-all duration-150 active:scale-90 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                      isLit
                        ? 'border-amber-600 bg-amber-50 shadow-[0_1px_4px_rgba(217,119,6,0.18)] hover:-translate-y-0.5'
                        : 'border-slate-300 bg-slate-50 hover:-translate-y-0.5 hover:border-emerald-600'
                    }`}
                  >
                    <BrandEmblem lit={isLit} size={16} />
                  </button>
                );
              })}
            </div>
            <span className="select-none text-xs font-semibold text-slate-500">1-5 arası puanla</span>
          </div>

          <span className="rounded-[7px] border border-emerald-200 bg-emerald-50 px-2.5 py-[3px] text-xs font-bold text-emerald-700 tabular-nums">
            {item.userRating > 0 ? `Puanın: ${item.userRating}/5` : `${avg} / 5`}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <button
            type="button"
            aria-expanded={isCommentsOpen}
            onClick={() => setIsCommentsOpen((prev) => !prev)}
            className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
              isCommentsOpen
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>
              Deneyimler / Yorumlar
              {hasLoadedComments ? ` (${comments.length})` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onShare(item)}
            aria-label={`${item.product} tavsiyesini paylaş`}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>Paylaş</span>
          </button>
        </div>

        {isCommentsOpen && (
          <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50/75 p-3">
            {item.isSeedPreview ? (
              <p className="text-xs text-slate-500">
                Yorumlar canlı veritabanı bağlantısı aktif olduğunda görüntülenir.
              </p>
            ) : (
              <>
                {isLoadingComments ? (
                  <p className="text-xs font-medium text-slate-500">Yorumlar yükleniyor...</p>
                ) : comments.length > 0 ? (
                  <ul className="space-y-2">
                    {comments.map((comment) => {
                      const canDeleteComment = Boolean(
                        currentUser && (comment.authorId === currentUser.uid || isAdmin),
                      );
                      const isConfirming = confirmCommentDeleteId === comment.id;
                      const isDeletingThis = deletingCommentId === comment.id;
                      return (
                        <li
                          key={comment.id}
                          className="rounded-lg border border-slate-200/80 bg-white px-3 py-2"
                        >
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[11.5px]">
                              <span className="font-bold text-slate-800">{comment.authorName}</span>
                              <span className="text-slate-400">·</span>
                              <span className="text-slate-500">
                                {formatCommentDate(comment.createdAtMs)}
                              </span>
                            </div>
                            {canDeleteComment && !isConfirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmCommentDeleteId(comment.id)}
                                className="cursor-pointer text-[11px] font-semibold text-slate-400 transition-colors hover:text-red-600"
                              >
                                Sil
                              </button>
                            )}
                            {canDeleteComment && isConfirming && (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => void handleDeleteComment(comment.id)}
                                  className="cursor-pointer rounded bg-red-600 px-1.5 py-0.5 text-[10.5px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
                                >
                                  {isDeletingThis ? '...' : 'Onayla'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isDeletingThis}
                                  onClick={() => setConfirmCommentDeleteId(null)}
                                  className="cursor-pointer rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-100"
                                >
                                  İptal
                                </button>
                              </div>
                            )}
                          </div>
                          <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-slate-700">
                            {comment.text}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">
                    Henüz ek deneyim notu yok. İlk yorumu sen paylaşabilirsin.
                  </p>
                )}

                {currentUser ? (
                  currentUser.emailVerified ? (
                    <form onSubmit={handleSubmitComment} className="space-y-2">
                      <textarea
                        rows={2}
                        minLength={3}
                        maxLength={600}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Uzun kullanım deneyimini veya kısa görüşünü yaz..."
                        aria-label={`${item.product} için deneyim yorumu`}
                        className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition-colors focus:border-emerald-600"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {commentText.trim().length}/600
                        </span>
                        <button
                          type="submit"
                          disabled={isSubmittingComment || commentText.trim().length < 3}
                          className="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSubmittingComment ? 'Gönderiliyor...' : 'Yorum Ekle'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-xs text-amber-700">
                      Yorum ekleyebilmek için doğrulanmış bir Google hesabı gereklidir.
                    </p>
                  )
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-xs text-slate-600">
                      Deneyim notu yazmak için Google hesabınla giriş yap.
                    </span>
                    <button
                      type="button"
                      onClick={() => void onSignIn()}
                      className="cursor-pointer whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100"
                    >
                      Google ile Giriş Yap
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

