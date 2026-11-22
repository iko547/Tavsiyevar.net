interface BrandEmblemProps {
  lit?: boolean;
  size?: number;
  className?: string;
}

export function BrandEmblem({ lit = true, size = 18, className = '' }: BrandEmblemProps) {
  if (lit) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={className}
      >
        {/* Sol Petrol / Camgöbeği Yıldız Yarısı (Fasetli) */}
        <polygon points="50,12 50,50 41,38" fill="#09484d" />
        <polygon points="41,38 50,50 14,38" fill="#178288" />
        <polygon points="14,38 50,50 36,60" fill="#0e6167" />
        <polygon points="36,60 50,50 28,88" fill="#157a80" />
        <polygon points="28,88 50,50 50,71" fill="#09484d" />
        {/* Sağ Alt Altın / Hardal Yıldız Kolu (Fasetli) */}
        <polygon points="50,12 59,38 50,50" fill="#d4a74a" />
        <polygon points="50,71 50,50 72,88" fill="#c89b43" />
        <polygon points="72,88 50,50 64,60" fill="#b38530" />
        {/* Sağ Üst Koldan Yükselen 3B Çift Renkli Ok */}
        <polygon points="58,60 66,60 85,39 85,46 92,46 92,23 85,23 64,53" fill="#0e6167" />
        <polygon points="50,50 58,50 75,30 68,23 92,23 85,39 79,34 62,55 50,55" fill="#cfa349" />
        <polygon points="68,23 92,23 75,30" fill="#deb358" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <polygon points="50,12 50,50 41,38" fill="#64748b" />
      <polygon points="41,38 50,50 14,38" fill="#cbd5e1" />
      <polygon points="14,38 50,50 36,60" fill="#94a3b8" />
      <polygon points="36,60 50,50 28,88" fill="#cbd5e1" />
      <polygon points="28,88 50,50 50,71" fill="#64748b" />
      <polygon points="50,12 59,38 50,50" fill="#e2e8f0" />
      <polygon points="50,71 50,50 72,88" fill="#cbd5e1" />
      <polygon points="72,88 50,50 64,60" fill="#94a3b8" />
      <polygon points="58,60 66,60 85,39 85,46 92,46 92,23 85,23 64,53" fill="#94a3b8" />
      <polygon points="50,50 58,50 75,30 68,23 92,23 85,39 79,34 62,55 50,55" fill="#e2e8f0" />
      <polygon points="68,23 92,23 75,30" fill="#f1f5f9" />
    </svg>
  );
}
