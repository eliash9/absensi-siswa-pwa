const CACHE = 'absensi-cache-v18';
const ASSETS = [
  './', 'index.html', 'settings.html', 'panduan.html', 'dashboard.html', 'about.html', 'styles.css', 'manifest.webmanifest',
  'js/db.js','js/app.js','js/sync.js','js/qr.js','js/settings.js','js/dashboard.js','js/ui.js',
  'js/vendor/qrcode.min.js','js/vendor/qrcode-generator.min.js','js/vendor/dexie.min.js',
  '/assets/icon-192.png','/assets/icon-512.png',
  // CDN dependencies to improve offline capability after first install
  'https://unpkg.com/html5-qrcode',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.mjs',
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.esm.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];
self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
      self.clients.claim()
    ])
  );
});
self.addEventListener('fetch', e=>{
  const req = e.request;
  const url = new URL(req.url);
  // Bypass SW for non-GET (e.g., sync POST) to avoid returning HTML fallback
  if(req.method !== 'GET'){
    return; // allow default network handling
  }
  // Same-origin: cache-first with network fallback; HTML offline fallback
  if(url.origin === location.origin){
    e.respondWith(
      caches.match(req).then(r=> r || fetch(req).then(resp=>{
        const copy = resp.clone(); caches.open(CACHE).then(c=>c.put(req, copy)); return resp;
      }).catch(()=> caches.match('index.html')))
  );
    return;
  }
  // Cross-origin: network-first with cache fallback (no HTML fallback)
  e.respondWith(
    fetch(req).then(resp=>{
      const copy = resp.clone(); caches.open(CACHE).then(c=>c.put(req, copy)); return resp;
    }).catch(()=> caches.match(req))
  );
});
