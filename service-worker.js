const CACHE_NAME = "dogam-randevu-v15";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "logo.jpeg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
