const CACHE_VERSION = "tototo-v2.2.0";
const RUNTIME_CACHE = "tototo-runtime-v2.2.0";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./save.js",
    "./sounds.js",
    "./statistics.js",
    "./achievements.js",
    "./missions.js",
    "./collection.js",
    "./upgrades.js",
    "./encyclopedia.js",
    "./prestige.js",
    "./albums.js",
    "./shop.js",
    "./game.js",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./Portadas/ARGAINC.webp",
    "./Portadas/CARTEL.webp",
    "./Portadas/DIOSES.webp",
    "./Portadas/FICHAS.webp",
    "./Portadas/HOLOGRAMA.webp",
    "./Portadas/LGEN1.webp",
    "./Portadas/RANDES.webp",
    "./Portadas/ROL.webp",
    "./Portadas/RVERSO.webp",
    "./Portadas/SURGE.webp",
    "./Portadas/TOTOTO.webp",
    "./Portadas/TRAINER.webp",
    "./Portadas/WOW.webp",
    "./Portadas/XCOM.webp"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => ![CACHE_VERSION, RUNTIME_CACHE].includes(key))
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request, "./index.html"));
        return;
    }

    if (url.hostname === "docs.google.com") {
        event.respondWith(networkFirst(request));
        return;
    }

    if (url.origin !== self.location.origin) return;

    if (/\/(Cromos|Portadas|icons)\//.test(url.pathname)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    await putRuntime(request, response);
    return response;
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const networkPromise = fetch(request)
        .then(async response => {
            await putRuntime(request, response);
            return response;
        })
        .catch(() => null);

    if (cached) {
        networkPromise.catch(() => null);
        return cached;
    }

    const networkResponse = await networkPromise;
    return networkResponse || new Response("Sin conexión", { status: 503 });
}

async function networkFirst(request, fallbackUrl = null) {
    try {
        const response = await fetch(request);
        await putRuntime(request, response);
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (fallbackUrl) {
            const fallback = await caches.match(fallbackUrl);
            if (fallback) return fallback;
        }

        return new Response("Sin conexión", { status: 503 });
    }
}

async function putRuntime(request, response) {
    if (!response || (!response.ok && response.type !== "opaque")) return;

    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
}
