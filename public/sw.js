/* Service worker застосунку «Малеча».
 *
 * Дані тут — імена дітей, телефони батьків, гроші — тож сторінки й API
 * НІКОЛИ не кешуються: вони завжди йдуть із мережі. Кешується лише те, що
 * не несе даних:
 *   - /offline.html та іконки — щоб без мережі показати зрозумілу заглушку
 *     замість помилки браузера;
 *   - /_next/static/* — файли з хешем в імені, вони незмінні за визначенням.
 *
 * Нова версія: змініть VERSION — старі кеші видаляться при активації.
 */
const VERSION = "v1";
const SHELL = `malecha-shell-${VERSION}`;
const STATIC = `malecha-static-${VERSION}`;
const SHELL_FILES = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL && key !== STATIC).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Переходи між сторінками: лише мережа; без неї — заглушка.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  // Незмінна статика збірки: спершу кеш.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Усе інше (API, дані, аватари, квитанції) браузер отримує напряму.
});
