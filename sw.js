const CACHE_NAME = 'otto8100-planning-v9';
const ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['./','./index.html']).catch(()=>{});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(url.hostname.includes('supabase') || url.hostname.includes('google') || url.hostname.includes('googleapis')) return;

  // Pagina principale: rete-prima.
  const isPagina = e.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/');
  if(isPagina){
    e.respondWith(
      fetch(e.request).then(res => {
        if(res && res.status === 200){ const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Icone e manifest: rete-prima, così un logo nuovo si vede subito.
  if(url.pathname.endsWith('.png') || url.pathname.endsWith('manifest.json')){
    e.respondWith(
      fetch(e.request).then(res => {
        if(res && res.status === 200){ const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Resto (font, CDN): cache-first.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if(res && res.status === 200 && res.type !== 'opaque'){ const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
