interface AssetsFetcher {
  fetch: (request: Request) => Promise<Response>;
}

interface WorkerEnv {
  ASSETS: AssetsFetcher;
  GEMINI_API_KEY?: string;
}

const ALLOWED_CATEGORIES = [
  'Yemek & Mekan',
  'Ev Aletleri',
  'Ses & Görüntü',
  'Bilgisayar & Aksesuar',
  'Temizlik & Ev Bakım',
  'Kişisel Bakım & Kozmetik',
  'Mutfak & Gıda',
  'Oto & Aksesuar',
  'Anne & Bebek',
] as const;

type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];

function matchAllowedCategory(candidate: unknown): AllowedCategory | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  const exact = ALLOWED_CATEGORIES.find((c) => c === trimmed);
  if (exact) return exact;
  const lower = trimmed.toLocaleLowerCase('tr-TR');
  return ALLOWED_CATEGORIES.find((c) => c.toLocaleLowerCase('tr-TR') === lower) ?? null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function callGeminiCategory(
  apiKey: string,
  model: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen',
  systemInstruction: string,
  userPrompt: string,
): Promise<{ ok: true; category: AllowedCategory; reason: string } | { ok: false; status: number; message: string }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'User-Agent': 'aistudio-build',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING' },
            reason: { type: 'STRING' },
          },
          required: ['category', 'reason'],
        },
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, message: text.slice(0, 300) };
  }

  const payload = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = (payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(rawText) as { category?: unknown; reason?: unknown };
  const validCategory = matchAllowedCategory(parsed.category);
  if (!validCategory) {
    return { ok: false, status: 502, message: 'INVALID_CATEGORY' };
  }

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
      ? parsed.reason.trim().slice(0, 140)
      : 'Yorum içeriğine göre önerildi.';

  return { ok: true, category: validCategory, reason };
}

async function handleSuggestCategory(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: { product?: unknown; note?: unknown } = {};
  try {
    body = (await request.json()) as { product?: unknown; note?: unknown };
  } catch {
    return jsonResponse({ error: 'Geçersiz istek gövdesi.' }, 400);
  }

  const product = typeof body.product === 'string' ? body.product.trim().slice(0, 200) : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

  if (note.length < 3 && product.length < 2) {
    return jsonResponse(
      { error: 'Kategori tahmini için en az ürün/mekan adı veya birkaç kelimelik yorum yazın.' },
      400,
    );
  }

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return jsonResponse(
      { error: 'GEMINI_API_KEY tanımlı değil. Lütfen sunucu gizli anahtarını ayarlayın.' },
      503,
    );
  }

  const systemInstruction = [
    'Sen tavsiyevar.net platformu için Türkçe ürün ve mekan yorumlarını sınıflandıran bir yapay zeka yardımcısısın.',
    'Kullanıcının girdiği ürün/mekan adı ve deneyim yorumunu analiz ederek aşağıdaki tam 9 kategoriden EN UYGUN TEK BİR TANESİNİ seç:',
    '1. "Yemek & Mekan": restoran, lokanta, kebapçı, kafe, kahvaltıcı, tatlıcı, fırın, dışarıda yeme-içme mekanı.',
    '2. "Ev Aletleri": elektrikli süpürge, robot süpürge, ütü, klima, çamaşır/bulaşık makinesi, airfryer, buzdolabı, küçük ev aletleri.',
    '3. "Ses & Görüntü": kulaklık, televizyon, projeksiyon, soundbar, hoparlör, mikrofon, kamera.',
    '4. "Bilgisayar & Aksesuar": laptop, monitör, mouse, klavye, SSD, modem, Wi-Fi router, tablet, telefon ve bilgisayar aksesuarları.',
    '5. "Temizlik & Ev Bakım": deterjan, yumuşatıcı, bulaşık tableti, yüzey temizleyici, yağ çözücü, çamaşır suyu, bez, temizlik malzemeleri.',
    '6. "Kişisel Bakım & Kozmetik": şampuan, krem, güneş kremi, parfüm, diş fırçası, tıraş makinesi, saç kurutma/şekillendirme, cilt bakımı.',
    '7. "Mutfak & Gıda": tencere, tava, termos, bıçak, kahve çekirdeği, zeytinyağı, gıda ürünleri ve elektriksiz mutfak gereçleri.',
    '8. "Oto & Aksesuar": araç içi kamera, lastik, oto paspas, araç kokusu, cam suyu, araç temizlik ve otomobil aksesuarları.',
    '9. "Anne & Bebek": bebek bezi, puset, bebek arabası, mama sandalyesi, biberon, bebek bakım ürünleri.',
    'Yalnızca bu 9 kategori adından birini aynen döndür ve "reason" alanına en fazla 8 kelimelik kısa Türkçe bir gerekçe yaz.',
  ].join('\n');

  const userPrompt = [
    product ? `Ürün / Mekan Adı: ${product}` : '',
    note ? `Kullanıcı Yorumu: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    let result = await callGeminiCategory(apiKey, 'gemini-3.1-flash-lite', systemInstruction, userPrompt);
    if (!result.ok && [429, 500, 502, 503, 504].includes(result.status)) {
      result = await callGeminiCategory(apiKey, 'gemini-4-hydrogen', systemInstruction, userPrompt);
    }

    if (result.ok) {
      return jsonResponse({ category: result.category, reason: result.reason }, 200);
    }

    if (result.status === 429) {
      return jsonResponse(
        { error: 'Ücretsiz yapay zeka kullanım kotası geçici olarak doldu, kategoriyi listeden seçebilirsiniz.' },
        429,
      );
    }
    if (result.status === 503) {
      return jsonResponse(
        { error: 'Ücretsiz yapay zeka servisinde geçici yoğunluk var, birazdan tekrar deneyebilir veya listeden seçebilirsiniz.' },
        503,
      );
    }
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      return jsonResponse({ error: 'Yapay zeka API anahtarı doğrulanamadı.' }, 502);
    }
    return jsonResponse({ error: 'Kategori analizi şu anda yapılamadı, listeden seçebilirsiniz.' }, 502);
  } catch {
    return jsonResponse({ error: 'Kategori analizi şu anda yapılamadı, listeden seçebilirsiniz.' }, 500);
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/suggest-category') {
      return handleSuggestCategory(request, env);
    }

    if (url.pathname.startsWith('/__/auth/')) {
      const targetUrl = `https://graphic-abode-rk58t.firebaseapp.com${url.pathname}${url.search}`;
      return fetch(new Request(targetUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
