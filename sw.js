const CACHE='nexo-pwa-v3-13h2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./assets/nexo-mark.png','./assets/icon-192.png','./assets/icon-512.png','./assets/icons/house.svg','./assets/icons/arrow-left-right.svg','./assets/icons/car-front.svg','./assets/icons/bot.svg','./assets/icons/settings.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
