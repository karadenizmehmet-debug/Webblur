/* WebBlur çevrimdışı önbellek — Mehmet Karadeniz, 2026-2027
   Yalnızca uygulama dosyalarını önbelleğe alır; kullanıcı fotoğrafları hiçbir yere gönderilmez. */
const CACHE = 'webblur-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg',
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

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
