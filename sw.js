// Service worker mínimo: permite instalar la app en el celular.
// No guarda copias de las páginas, así siempre se ve la disponibilidad real.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
