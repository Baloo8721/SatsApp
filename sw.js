const CACHE = "sat-sprint-v5";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/config.js",
  "./js/sync.js",
  "./js/store.js",
  "./js/activity.js",
  "./js/srs.js",
  "./js/quiz.js",
  "./js/generators.js",
  "./vendor/supabase.js",
  "./data/topics.json",
  "./data/formulas.json",
  "./data/flashcards.json",
  "./data/rw-lessons.json",
  "./data/rw-questions.json",
  "./data/math-questions.json",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/formulas/image1.webp",
  "./assets/formulas/image2.webp",
  "./assets/formulas/image3.webp",
  "./assets/formulas/image4.webp",
  "./assets/formulas/image5.webp",
  "./assets/formulas/image6.webp",
  "./assets/formulas/image7.webp",
  "./assets/formulas/image8.webp",
  "./assets/formulas/image9.webp",
  "./assets/formulas/image10.webp",
  "./assets/formulas/image11.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (url.pathname.endsWith("/js/config.js")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response("window.SAT_CONFIG = window.SAT_CONFIG || { supabaseUrl: \"\", supabaseAnonKey: \"\" };", {
            headers: { "Content-Type": "application/javascript" }
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
