# WebBlur v1.2

Fotoğraflardaki yüzleri **cihaz üzerinde** bulanıklaştıran web uygulaması.
Fotoğraflar hiçbir sunucuya yüklenmez; yüz tespiti ve bulanıklaştırma tarayıcıda yapılır.

## Özellikler
- Birden fazla fotoğrafı aynı anda ekleme
- Otomatik yüz tespiti (SSD MobileNet, kalabalık fotoğraflar için parçalı tarama)
- Gizleme türü: Blur, Mozaik, Emoji (tek veya her yüze farklı), Düz renk
- Blur/mozaik derecesi, kenar payı, tespit hassasiyeti ve şekil (oval / dikdörtgen) ayarı — önce veya sonra değiştirilebilir, önizleme anında güncellenir
- Fotoğrafa dokunup tek tek yüzü açma/kapatma, elle bölge ekleme, önce/sonra karşılaştırma
- Toplu indirme (ZIP) veya telefonda Paylaş / Kaydet
- Çıktıda EXIF/konum bilgisi bulunmaz
- İlk açılıştan sonra çevrimdışı çalışır (PWA)

## Kullanım
GitHub Pages üzerinden açın: Settings → Pages → Branch: `main` / root.

## Sürümler
- **v1.3** — Koyu / normal mod düğmesi (varsayılan sistem ayarını izler)
- **v1.2** — Düzenleyicide geri al / ileri al, yakınlaştırma (iki parmak, tekerlek, +/− düğmeleri), Tümünü kaldır / geri getir
- **v1.1** — Gizleme türleri (Blur, Mozaik, Emoji, Düz renk); düzenleyicide tür seçimi; önbellek düzeltmesi
- **v1.0** — İlk sürüm: toplu yüz bulanıklaştırma, ZIP indirme

## Kütüphaneler
- [@vladmandic/face-api](https://github.com/vladmandic/face-api) 1.7.15 (MIT) — `lib/`, `model/`
- [JSZip](https://stuk.github.io/jszip/) 3.10.2 (MIT) — `lib/`

© Mehmet Karadeniz, 2026-2027
