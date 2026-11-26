import 'dotenv/config';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  return (
    ALLOWED_CATEGORIES.find((c) => c.toLocaleLowerCase('tr-TR') === lower) ??
    null
  );
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use('/api', express.json({ limit: '16kb' }));

  app.post('/api/suggest-category', async (req, res) => {
    const body = (req.body ?? {}) as { product?: unknown; note?: unknown };
    const product =
      typeof body.product === 'string' ? body.product.trim().slice(0, 200) : '';
    const note =
      typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

    if (note.length < 3 && product.length < 2) {
      res.status(400).json({
        error: 'Kategori tahmini için en az ürün/mekan adı veya birkaç kelimelik yorum yazın.',
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY tanımlı değil. Lütfen Settings > Secrets üzerinden API anahtarını kontrol edin.',
      });
      return;
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

    const callCategoryModel = async (modelName: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen') => {
      return ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.STRING,
                description: 'Allowed exact category name in Turkish.',
              },
              reason: {
                type: Type.STRING,
                description: 'Brief Turkish explanation under 8 words.',
              },
            },
            required: ['category', 'reason'],
          },
        },
      });
    };

    const isRetryableError = (err: unknown): boolean => {
      const e = err as { status?: number; message?: string };
      const st = typeof e?.status === 'number' ? e.status : 0;
      const msg = typeof e?.message === 'string' ? e.message : '';
      return (
        st === 429 ||
        st === 500 ||
        st === 502 ||
        st === 503 ||
        st === 504 ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED')
      );
    };

    try {
      let response;
      try {
        response = await callCategoryModel('gemini-3.1-flash-lite');
      } catch (firstErr) {
        if (!isRetryableError(firstErr)) throw firstErr;
        response = await callCategoryModel('gemini-4-hydrogen');
      }

      const rawText = (response.text ?? '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(rawText) as { category?: unknown; reason?: unknown };
      const validCategory = matchAllowedCategory(parsed.category);

      if (!validCategory) {
        res.status(502).json({
          error: 'Yapay zeka geçerli bir kategori belirleyemedi, lütfen listeden seçin.',
        });
        return;
      }

      const reason =
        typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
          ? parsed.reason.trim().slice(0, 140)
          : 'Yorum içeriğine göre önerildi.';

      res.json({ category: validCategory, reason });
    } catch (error) {
      const errObj = error as { status?: number; message?: string; name?: string };
      const status = typeof errObj?.status === 'number' ? errObj.status : 500;
      const message = typeof errObj?.message === 'string' ? errObj.message : '';
      console.error('[suggest-category] failed:', {
        name: errObj?.name,
        status,
        message: message.slice(0, 300),
      });

      if (status === 429 || message.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'Ücretsiz yapay zeka kullanım kotası geçici olarak doldu, kategoriyi listeden seçebilirsiniz.',
        });
        return;
      }

      if (status === 503 || message.includes('UNAVAILABLE')) {
        res.status(503).json({
          error: 'Ücretsiz yapay zeka servisinde geçici yoğunluk var, birazdan tekrar deneyebilir veya listeden seçebilirsiniz.',
        });
        return;
      }

      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        message.includes('API_KEY_INVALID') ||
        message.includes('PERMISSION_DENIED')
      ) {
        res.status(502).json({
          error: 'Yapay zeka API anahtarı doğrulanamadı. Lütfen Settings > Secrets ayarını kontrol edin.',
        });
        return;
      }

      if (status === 404 || message.includes('NOT_FOUND')) {
        res.status(502).json({
          error: 'Yapay zeka modeline şu anda ulaşılamıyor, kategoriyi listeden seçebilirsiniz.',
        });
        return;
      }

      res.status(500).json({
        error: 'Kategori analizi şu anda yapılamadı, kategoriyi listeden seçebilirsiniz.',
      });
    }
  });

  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
