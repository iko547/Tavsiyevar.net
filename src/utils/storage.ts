import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { INITIAL_RECOMMENDATIONS } from '../data/initialRecommendations';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Category, MediaItem, Recommendation, RecommendationComment } from '../types/recommendation';

export const MAX_MEDIA_ITEMS = 3;
const MAX_MEDIA_DATAURL_CHARS = 280000;
const GUEST_VOTES_STORAGE_KEY = 'tavsiyevar_guest_votes_v1';
export const REMOVED_LEGACY_REC_IDS = new Set<string>(['rec-1795180977244-8kka']);

export function loadGuestVotes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(GUEST_VOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: Record<string, number> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([k, v]) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= 5) {
        cleaned[k] = n;
      }
    });
    return cleaned;
  } catch {
    return {};
  }
}

export function saveGuestVote(recId: string, score: number): Record<string, number> {
  const current = loadGuestVotes();
  const next = { ...current, [recId]: score };
  try {
    localStorage.setItem(GUEST_VOTES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors in restricted browsing modes
  }
  return next;
}

export function normalizeTurkish(text: string): string {
  return text.trim().toLocaleLowerCase('tr-TR');
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.readAsDataURL(file);
  });
}

function compressImageForFirestore(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objUrl);
          reject(new Error('Görsel işlenemedi'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.78;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > MAX_MEDIA_DATAURL_CHARS && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (dataUrl.length > MAX_MEDIA_DATAURL_CHARS) {
          const smallCanvas = document.createElement('canvas');
          smallCanvas.width = Math.max(1, Math.round(width * 0.65));
          smallCanvas.height = Math.max(1, Math.round(height * 0.65));
          const smallCtx = smallCanvas.getContext('2d');
          if (smallCtx) {
            smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
            dataUrl = smallCanvas.toDataURL('image/jpeg', 0.65);
          }
        }

        URL.revokeObjectURL(objUrl);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(objUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Görsel okunamadı'));
    };
    img.src = objUrl;
  });
}

export interface MediaConversionResult {
  item: MediaItem | null;
  error?: string;
}

export async function fileToMediaItem(file: File): Promise<MediaConversionResult> {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) {
    return { item: null, error: 'Yalnızca fotoğraf veya video dosyaları desteklenir.' };
  }

  const id = `med-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (isImage) {
    try {
      const url = await compressImageForFirestore(file);
      if (url.length > MAX_MEDIA_DATAURL_CHARS) {
        return { item: null, error: 'Fotoğraf boyutu çok büyük, lütfen daha küçük bir görsel seçin.' };
      }
      return { item: { id, type: 'image', url, name: file.name.slice(0, 160) } };
    } catch {
      return { item: null, error: 'Fotoğraf işlenemedi.' };
    }
  }

  if (file.size > 200 * 1024) {
    return {
      item: null,
      error: 'Video boyutu veritabanı sınırını (200 KB) aşıyor. Fotoğraf veya çok kısa bir klip seçebilirsiniz.',
    };
  }

  try {
    const url = await readAsDataURL(file);
    if (url.length > MAX_MEDIA_DATAURL_CHARS) {
      return {
        item: null,
        error: 'Video boyutu veritabanı sınırını aşıyor. Lütfen daha küçük bir dosya seçin.',
      };
    }
    return { item: { id, type: 'video', url, name: file.name.slice(0, 160) } };
  } catch {
    return { item: null, error: 'Video dosyası okunamadı.' };
  }
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  return 0;
}

export function subscribePublicRecommendations(
  onData: (items: Recommendation[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'recommendations';
  const q = query(collection(db, path), where('isPublic', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Recommendation[] = snapshot.docs
        .filter((docSnap) => !REMOVED_LEGACY_REC_IDS.has(docSnap.id))
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            product: String(d.product || ''),
            category: d.category as Category,
            location: typeof d.location === 'string' && d.location.trim() ? d.location.trim() : undefined,
            duration: String(d.duration || ''),
            note: String(d.note || ''),
            media: Array.isArray(d.media) ? (d.media as MediaItem[]) : [],
            userRating: 0,
            ratingSum: Number(d.ratingSum) || 0,
            ratingCount: Number(d.ratingCount) || 0,
            authorId: typeof d.authorId === 'string' ? d.authorId : undefined,
            authorName: typeof d.authorName === 'string' ? d.authorName : undefined,
            createdAtMs: toMillis(d.createdAt),
          };
        });

      items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeUserVotes(
  userId: string,
  onData: (votes: Record<string, number>) => void,
  onError: (err: Error) => void,
): () => void {
  const path = `users/${userId}/votes`;
  return onSnapshot(
    collection(db, 'users', userId, 'votes'),
    (snapshot) => {
      const votes: Record<string, number> = {};
      snapshot.docs.forEach((docSnap) => {
        const score = Number(docSnap.data().score);
        if (score >= 1 && score <= 5) {
          votes[docSnap.id] = score;
        }
      });
      onData(votes);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function seedInitialRecommendationsIfEmpty(user: User): Promise<void> {
  const path = 'recommendations';
  try {
    const existingSnap = await getDocs(
      query(collection(db, path), where('isPublic', '==', true), limit(1)),
    );
    if (!existingSnap.empty) return;

    const batch = writeBatch(db);
    INITIAL_RECOMMENDATIONS.forEach((item) => {
      const ref = doc(db, path, item.id);
      batch.set(ref, {
        product: item.product,
        category: item.category,
        duration: item.duration,
        note: item.note,
        media: [],
        authorId: user.uid,
        authorName: 'tavsiyevar.net',
        isPublic: true,
        ratingSum: item.ratingSum,
        ratingCount: item.ratingCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cleanupRemovedRecommendationsIfAuthorized(): Promise<void> {
  for (const id of REMOVED_LEGACY_REC_IDS) {
    try {
      await deleteDoc(doc(db, 'recommendations', id));
    } catch {
      // Ignore if already deleted or current user is not owner/admin
    }
  }
}

export interface CreateRecommendationInput {
  product: string;
  category: Category;
  location?: string;
  duration: string;
  note: string;
  media: MediaItem[];
}

export async function createRecommendationInFirestore(
  input: CreateRecommendationInput,
  user: User,
): Promise<string> {
  const recId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const path = `recommendations/${recId}`;
  const authorName = (user.displayName || user.email?.split('@')[0] || 'Kullanıcı').slice(0, 100);
  const cleanLocation = input.location?.trim().slice(0, 100);

  try {
    await setDoc(doc(db, 'recommendations', recId), {
      product: input.product.slice(0, 180),
      category: input.category,
      ...(cleanLocation && cleanLocation.length >= 2 ? { location: cleanLocation } : {}),
      duration: input.duration.slice(0, 60),
      note: input.note.slice(0, 2000),
      media: input.media.slice(0, MAX_MEDIA_ITEMS),
      authorId: user.uid,
      authorName,
      isPublic: true,
      ratingSum: 5,
      ratingCount: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return recId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function submitVoteInFirestore(
  recId: string,
  score: number,
  guestPrevScore: number,
  user: User | null,
): Promise<void> {
  const recRef = doc(db, 'recommendations', recId);
  const path = `recommendations/${recId}`;

  try {
    await runTransaction(db, async (tx) => {
      const recSnap = await tx.get(recRef);
      if (!recSnap.exists()) {
        throw new Error('Tavsiye bulunamadı.');
      }

      const data = recSnap.data();
      const existingSum = Number(data.ratingSum) || 0;
      const existingCount = Number(data.ratingCount) || 0;

      if (user && user.emailVerified) {
        const voteRef = doc(db, 'users', user.uid, 'votes', recId);
        const voteSnap = await tx.get(voteRef);
        const priorScore = voteSnap.exists()
          ? Number(voteSnap.data().score) || 0
          : guestPrevScore;

        const nextCount = priorScore > 0 ? existingCount : existingCount + 1;
        const nextSum =
          priorScore > 0 ? existingSum - priorScore + score : existingSum + score;

        tx.update(recRef, {
          ratingSum: nextSum,
          ratingCount: nextCount,
          updatedAt: serverTimestamp(),
        });

        tx.set(voteRef, {
          userId: user.uid,
          recId,
          score,
          updatedAt: serverTimestamp(),
        });
      } else {
        const nextCount = guestPrevScore > 0 ? existingCount : existingCount + 1;
        const nextSum =
          guestPrevScore > 0 ? existingSum - guestPrevScore + score : existingSum + score;

        tx.update(recRef, {
          ratingSum: nextSum,
          ratingCount: nextCount,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteRecommendationInFirestore(recId: string): Promise<void> {
  const path = `recommendations/${recId}`;
  try {
    await deleteDoc(doc(db, 'recommendations', recId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeRecommendationComments(
  recId: string,
  onData: (comments: RecommendationComment[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = `recommendations/${recId}/comments`;
  const q = query(collection(db, 'recommendations', recId, 'comments'), where('isPublic', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const comments: RecommendationComment[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          recId,
          text: String(d.text || ''),
          authorId: String(d.authorId || ''),
          authorName: String(d.authorName || 'Kullanıcı'),
          createdAtMs: toMillis(d.createdAt),
        };
      });
      comments.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      onData(comments);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function createCommentInFirestore(
  recId: string,
  text: string,
  user: User,
): Promise<string> {
  const commentId = `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const path = `recommendations/${recId}/comments/${commentId}`;
  const authorName = (user.displayName || user.email?.split('@')[0] || 'Kullanıcı').slice(0, 100);
  const cleanText = text.trim().slice(0, 600);

  try {
    await setDoc(doc(db, 'recommendations', recId, 'comments', commentId), {
      recId,
      text: cleanText,
      authorId: user.uid,
      authorName,
      isPublic: true,
      createdAt: serverTimestamp(),
    });
    return commentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCommentInFirestore(
  recId: string,
  commentId: string,
): Promise<void> {
  const path = `recommendations/${recId}/comments/${commentId}`;
  try {
    await deleteDoc(doc(db, 'recommendations', recId, 'comments', commentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
