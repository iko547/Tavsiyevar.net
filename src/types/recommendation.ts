export type Category =
  | 'Yemek & Mekan'
  | 'Ev Aletleri'
  | 'Ses & Görüntü'
  | 'Bilgisayar & Aksesuar'
  | 'Temizlik & Ev Bakım'
  | 'Kişisel Bakım & Kozmetik'
  | 'Mutfak & Gıda'
  | 'Oto & Aksesuar'
  | 'Anne & Bebek';

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
  location?: string;
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
