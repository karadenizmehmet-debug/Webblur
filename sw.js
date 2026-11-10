/* WebBlur çevrimdışı önbellek — Mehmet Karadeniz, 2026-2027
   Yalnızca uygulama dosyalarını önbelleğe alır; kullanıcı fotoğrafları hiçbir yere gönderilmez. */
const VERSION = '1.1';
const CACHE = `webblur-v${VERSION}`;
const ASSETS = [
  './', 'index.html', 'style.css?v=' + VERSION, 'app.js?v=' + VERSION, 'manifest.json', 'icon.svg',
  'lib/face-api.js', 'lib/jszip.min.js',
  'model/ssd_mobilenetv1_model-weights_manifest.json', 'model/ssd_mobilenetv1_model.bin',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Kütüphane ve model: önce önbellek (büyük, değişmez). Uygulama dosyaları: önce ağ (güncellemeler hemen gelsin).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isStatic = /\/(lib|model)\//.test(url.pathname);
  if (isStatic) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
