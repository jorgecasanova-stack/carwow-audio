/* Carwow Audio service worker — instalable + audios offline + avisos de noticias */
const VERSION = 'cwa-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'];
const KNOWN_KEY = 'cwa-known-news';   // ids de noticias ya conocidas (en Cache)

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // App shell (navegación / HTML / manifest): network-first, para que la app
  // se actualice sola cuando hay conexión. Cae a caché si no hay red.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')
      || url.pathname === '/' || url.pathname.endsWith('manifest.json')
      || url.pathname.endsWith('manifest.webmanifest')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // audios e imágenes: cache-first (para escuchar sin conexión lo ya oído)
  if (/\.(mp3|jpg|jpeg|png|webp)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
      )
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});

/* ---------- Avisos de noticias nuevas ---------- */
async function getKnown() {
  const c = await caches.open(VERSION);
  const r = await c.match(KNOWN_KEY);
  return r ? r.json() : [];
}
async function setKnown(ids) {
  const c = await caches.open(VERSION);
  await c.put(KNOWN_KEY, new Response(JSON.stringify(ids), { headers: { 'Content-Type': 'application/json' } }));
}

async function checkNews(seedOnly) {
  let m;
  try {
    const res = await fetch('manifest.json?t=' + Date.now(), { cache: 'no-store' });
    m = await res.json();
  } catch (e) { return; }
  const news = (m.episodes || []).filter((x) => x.categoria === 'noticias');
  const ids = news.map((x) => x.id);
  if (seedOnly) { await setKnown(ids); return; }     // solo memoriza, no avisa
  const known = await getKnown();
  const fresh = news.filter((x) => !known.includes(x.id));
  await setKnown(ids);
  if (!fresh.length) return;
  const title = fresh.length === 1 ? '📰 Nueva noticia en Carwow Audio' : `📰 ${fresh.length} noticias nuevas`;
  const body = fresh.slice(0, 3).map((x) => x.name).join(' · ');
  await self.registration.showNotification(title, {
    body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: 'cwa-news', data: { url: './index.html#' + fresh[0].id },
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'cwa-news-check') e.waitUntil(checkNews(false));
});
self.addEventListener('message', (e) => {
  if (e.data === 'cwa-seed-news') e.waitUntil(checkNews(true));
  if (e.data === 'cwa-check-news') e.waitUntil(checkNews(false));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
    for (const c of cl) { if ('focus' in c) { if (c.navigate) c.navigate(target); return c.focus(); } }
    return clients.openWindow(target);
  }));
});
