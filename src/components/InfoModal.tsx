import { useEffect } from 'react';
import { BrandEmblem } from './BrandEmblem';

export type InfoModalTab = 'about' | 'terms' | 'privacy' | 'contact';

interface InfoModalProps {
  activeTab: InfoModalTab | null;
  onClose: () => void;
  onChangeTab: (tab: InfoModalTab) => void;
}

const TAB_LABELS: Record<InfoModalTab, string> = {
  about: 'Hakkında',
  terms: 'Kullanım Koşulları',
  privacy: 'Gizlilik',
  contact: 'İletişim',
};

export function InfoModal({ activeTab, onClose, onChangeTab }: InfoModalProps) {
  useEffect(() => {
    if (!activeTab) return;
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
  }, [activeTab, onClose]);

  if (!activeTab) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="infoModalHeading"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[88vh] w-full max-w-[580px] overflow-y-auto rounded-[18px] border border-slate-200 bg-white shadow-[0_20px_35px_-10px_rgba(15,23,42,0.2)]">
        <div className="sticky top-0 z-[5] flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BrandEmblem lit size={22} />
            <h2 id="infoModalHeading" className="text-[17px] font-bold text-slate-900">
              {TAB_LABELS[activeTab]}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] border border-slate-200 bg-slate-50 text-lg leading-none text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            &times;
          </button>
        </div>

        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
            {(Object.keys(TAB_LABELS) as InfoModalTab[]).map((tab) => {
              const isSelected = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onChangeTab(tab)}
                  className={`shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 p-5 text-sm leading-relaxed text-slate-600">
          {activeTab === 'about' && (
            <>
              <p className="font-semibold text-slate-900">
                tavsiyevar.net nedir?
              </p>
              <p>
                tavsiyevar.net; elektronikten ev eşyasına, temizlik ürünlerinden yeme-içme mekanlarına kadar gerçek kullanıcı deneyimlerini bir araya getiren bağımsız bir fiyat/performans tavsiye topluluğudur.
              </p>
              <p>
                Amacımız reklam veya sponsorlu yönlendirmeler yerine, ürünü gerçekten kullanmış ya da mekanı bizzat deneyimlemiş kişilerin samimi değerlendirmelerine kolayca ulaşmanızı sağlamaktır.
              </p>
            </>
          )}

          {activeTab === 'terms' && (
            <>
              <p className="font-semibold text-slate-900">Kullanım Koşulları</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Platformda paylaşılan tüm tavsiyeler, fotoğraflar ve yorumlar yalnızca paylaşan kullanıcının kişisel deneyimini yansıtır.</li>
                <li>Hakaret, reklam spamı, yanıltıcı içerik veya hukuka aykırı paylaşımlar site yönetimi tarafından kaldırılabilir.</li>
                <li>Tavsiye ve yorum paylaşabilmek için doğrulanmış Google hesabıyla oturum açılması gerekir; puanlama ise tüm ziyaretçilere açıktır.</li>
              </ul>
            </>
          )}

          {activeTab === 'privacy' && (
            <>
              <p className="font-semibold text-slate-900">Gizlilik Politikası</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Paylaşılan tavsiye ve yorumlarda e-posta adresiniz herkese açık olarak yayınlanmaz; yalnızca görünen adınız kullanılır.</li>
                <li>Üyeliksiz verdiğiniz 1–5 arası oylar yalnızca aynı oyu tekrar güncelleyebilmeniz için tarayıcınızın yerel belleğinde tutulur.</li>
                <li>Paylaştığınız tavsiyeyi veya yorumu dilediğiniz zaman kart üzerindeki Sil butonunu kullanarak kalıcı olarak silebilirsiniz.</li>
              </ul>
            </>
          )}

          {activeTab === 'contact' && (
            <>
              <p className="font-semibold text-slate-900">İletişim &amp; Geri Bildirim</p>
              <p>
                Öneri, hatalı içerik bildirimi veya iş birliği talepleriniz için bizimle doğrudan e-posta üzerinden iletişime geçebilirsiniz:
              </p>
              <p>
                <a
                  href="mailto:yorganciyonca@gmail.com"
                  className="font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                >
                  yorganciyonca@gmail.com
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
