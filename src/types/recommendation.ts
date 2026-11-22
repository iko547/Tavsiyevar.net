export type Category = 'Ev Aletleri' | 'Ses & Görüntü' | 'Bilgisayar & Aksesuar';

export type CategoryFilter = 'Tümü' | Category;

export interface MediaItem {
  id: string;
  type: 'image' | 'video';
  url: string;
  name: string;
}

export interface Recommendation {
  id: string;
  product: string;
  category: Category;
  duration: string;
  note: string;
  media: MediaItem[];
  userRating: number;
  ratingSum: number;
  ratingCount: number;
  authorId?: string;
  authorName?: string;
  createdAtMs?: number;
  isSeedPreview?: boolean;
}
