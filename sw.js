const CACHE_NAME = 'otto8100-planning-v2';
const ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // cache solo i file locali, le CDN possono fallire in offline
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
  // solo GET, solo stessa origine o CDN note
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // per Supabase e Google API: network-first, non cachare
  if(url.hostname.includes('supabase') || url.hostname.includes('google') || url.hostname.includes('googleapis')) return;

  // Per la pagina principale (navigazione e index.html): sempre rete-prima,
  // così ogni aggiornamento si vede già al primo refresh — la cache serve
  // solo come fallback quando sei offline. Questa è la differenza chiave
  // rispetto a prima, dove la pagina restava bloccata sulla versione
  // salvata in cache finché non si ricaricava una seconda volta.
  const isPagina = e.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/');
  if(isPagina){
    e.respondWith(
      fetch(e.request).then(res => {
        if(res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Per il resto (font, librerie CDN): cache-first va bene, cambiano raramente.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if(res && res.status === 200 && res.type !== 'opaque'){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
