/**
 * Service worker : mise en cache complete pour un fonctionnement hors ligne.
 *
 * A l'installation on met en cache la coquille de l'application, puis on lit
 * index.html pour y trouver les fichiers JS/CSS (dont le nom contient un hash
 * genere par Vite) et les mettre en cache egalement. Ensuite tout ce qui est
 * servi par la meme origine est mis en cache au fil de l'eau.
 */
const CACHE = 'ragzayn-break-v1';
const SCOPE = new URL(self.registration.scope).pathname;

const SHELL = [
  SCOPE,
  `${SCOPE}index.html`,
  `${SCOPE}manifest.webmanifest`,
  `${SCOPE}config/hero.json`,
  `${SCOPE}config/tools.json`,
  `${SCOPE}config/levels-overrides.json`,
  `${SCOPE}config/level-fixes.json`,
  `${SCOPE}icons/icon-192.png`,
  `${SCOPE}icons/icon-512.png`,
  `${SCOPE}icons/apple-touch-icon.png`,
];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));

  // Enregistrement de la voix : optionnel, son absence ne doit pas faire echouer
  // toute la mise en cache (cache.addAll est atomique).
  try {
    await cache.add(new Request(`${SCOPE}audio/bravo-zayn.mp3`, { cache: 'reload' }));
  } catch {
    /* pas d'enregistrement : la synthese vocale prendra le relais */
  }

  try {
    const html = await (await fetch(`${SCOPE}index.html`, { cache: 'reload' })).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
      .map((m) => new URL(m[1], self.registration.scope).href);
    if (assets.length) await cache.addAll(assets);
  } catch (e) {
    // Les fichiers seront mis en cache a la premiere utilisation.
    console.warn('Precache partiel', e);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigation : reseau d'abord (pour recuperer une mise a jour), cache en secours.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(`${SCOPE}index.html`, copy));
          return response;
        })
        .catch(() => caches.match(`${SCOPE}index.html`, { ignoreVary: true }).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Configuration et enregistrement de la voix sont petits et destines a etre
  // remplaces : on privilegie le reseau pour qu'une retouche soit prise en
  // compte, avec repli sur le cache hors ligne.
  const path = new URL(request.url).pathname;
  if (path.includes('/config/') || path.includes('/audio/')) {
    event.respondWith(serveFreshFirst(request));
    return;
  }

  event.respondWith(serveFromCache(request));
});

/** Reseau d'abord, cache en secours. */
async function serveFreshFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    return new Response('Configuration indisponible hors ligne', { status: 504, statusText: 'Hors ligne' });
  }
}

/**
 * Cache d'abord, reseau ensuite.
 *
 * `ignoreVary` est indispensable : Vite ajoute l'attribut `crossorigin` aux
 * balises script et link, et l'en-tete `Vary` renvoye par certains serveurs
 * suffit sinon a faire echouer la correspondance, donc le mode hors ligne.
 */
async function serveFromCache(request) {
  const options = { ignoreVary: true };
  const cached = (await caches.match(request, options)) ?? (await caches.match(request.url, options));
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && (response.type === 'basic' || response.type === 'default')) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Hors ligne et absent du cache : on renvoie une erreur explicite.
    return new Response('Ressource indisponible hors ligne', { status: 504, statusText: 'Hors ligne' });
  }
}
