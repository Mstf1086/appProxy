---
description: Token bütçesi kuralları — her oturumda geçerli
---

# Token Bütçesi Kuralları

Bu proje **token açısından pahalı**: `docs/` altında 2,5 MB'lık bir OpenAPI
aynası, 5 000 satırlık protokol dokümanları ve 100+ test var. Aşağıdaki kurallar
tek amaç için: **aynı işi daha az bağlamla yapmak.** Bağlam dolduğunda model
kalitesi düşer, oturum ortasında compaction gerekir; bu kurallar onu önler.

## 1. Okumadan önce ara

- Bir dosyayı açmadan önce **her zaman** `grep -n` ile satır numarasını bul.
- `Read` çağrısında `offset` + `limit` kullan; 200 satırdan uzun okuma yapma.
- Aynı dosyanın aynı bölgesini **ikinci kez okuma**. Okuduysan not al, tekrar
  okumak yerine notu kullan. Bir düzenleme sonrası içeriği doğrulamak için
  dosyayı baştan okuma — `git diff` yeterli.
- `docs/` bir **doküman aynasıdır** (dış kaynakların birebir kopyası). Oradan
  yalnızca belirli bir iddiayı doğrulamak için 20–40 satır oku; dosyayı bütün
  olarak okuma. `docs/openrouter/openapi.json` (2,5 MB) hiçbir zaman okunmaz;
  gerekirse `node -e` ile tek alan çekilir.

## 2. Komut çıktısını kırp

- Test: `npm test 2>&1 | grep -E "^# (tests|pass|fail)|^not ok" -A 8`
  — tam TAP çıktısı 1 000+ satır, gerekli olan 3 satır.
- `git`: `git log --oneline -10`, `git diff --stat`, `git status --short`.
  `git log -p` ve `git diff` (tam) yalnızca incelenecek dosya belliyse.
- Dosya listesi: `ls | head`, `find ... | head -20`. Tüm ağaç dökümü yok.
- JSON/uzun çıktı: `head -c 400` veya `node -e 'console.log(JSON.stringify(x,null,2))'`
  ile sadece ilgili alanı yazdır.
- Komut çıktısı 200 satırı geçecekse **baştan kırp**; sonradan kırpmak için
  çıktıyı zaten bağlama almış olursun.

## 3. Düzenleme

- Mevcut dosyada `Edit` kullan, `Write` **yalnızca yeni dosya** için.
- Dosyayı baştan yazmak hem token hem risk maliyeti: diff okunamaz hale gelir.
- İlişkili değişiklikleri **tek turda** yap (aynı dosyada 5 küçük `Edit`,
  5 ayrı turdan daha ucuzdur).
- Değişiklik sonrası doğrulama: `npm test` + `git diff --stat`. Dosyayı tekrar
  okumak yerine test sonucu ve diff özeti yeter.

## 4. Test stratejisi

- Geliştirirken **tek dosya**: `node --test tests/stream-usage.test.mjs`.
- Commit öncesi tam paket: `npm test` (yaklaşık 2,5 sn — ucuz, atlanmaz).
- Test çıktısında yalnızca `not ok` blokları ve `# pass/# fail` satırları önemli.
- Yeni test yazarken mevcut bir test dosyasını **şablon** olarak kullan
  (`tests/gemini-provider.test.mjs` iyi bir örnek); sıfırdan kurulum yapma.

## 5. Keşif ve alt ajanlar

- "Bu fonksiyon nerede kullanılıyor / bu akış nasıl çalışıyor" gibi **geniş**
  soruları alt ajana ver; ana bağlama yalnızca **özet** dönsün.
- Alt ajana dosya listesi + satır numarası ver, "kodu incele" gibi açık uçlu
  görev verme — aksi halde tüm dosyaları o okur ve özeti yine büyük olur.
- Tek bir sembol arıyorsan alt ajan **kullanma**: `grep -rn "sembol" src/`.

## 6. Yanıt biçimi

- Kodu geri yapıştırma; "şu dosyada şu satır değişti" yeter.
- Uzun açıklama yerine **tablo** veya 3–5 maddelik liste.
- Kullanıcı Türkçe yazıyorsa Türkçe yanıtla; kod, commit mesajı ve tanımlayıcılar
  ASCII kalır (bkz. `AGENTS.md` → Dil).
- Belirsizlik varsa tek soru sor, tahmin edip iki kez uygulama.

## 7. Oturum hijyeni

- İlgisiz göreve geçerken bağlamı taşıma; yeni oturum aç.
- Uzun bir dosyayı okuduktan sonra özetini 3 satırda tut, ham içeriği değil.
- Aynı hatayı ikinci kez almamak için hatayı **tek satırda** kaydet; tüm stack
  trace'i bağlamda tutma.

## 8. Bu repoya özgü pahalı tuzaklar

| Tuzak | Neden pahalı | Yerine |
| --- | --- | --- |
| `cat docs/openrouter/openapi.json` | 2,5 MB | `node -e` ile alan çek |
| Tam `npm test` çıktısı | 1 000+ satır TAP | yalnızca `# pass` / `# fail` / `not ok` satırlarını süz |
| `docs/anthropic/api/messages.md` (5 000+ satır) | tek okuma bütçenin yarısı | `grep -n "konu"` + 30 satır |
| `git log -p` | tüm geçmiş diff'i | `git log --oneline -10` |
| Derin `find .` | node_modules + docs aynası | `--exclude-dir` + `head` |
| Bir dosyayı "kontrol için" tekrar okumak | iki katı maliyet | `git diff <dosya>` |
