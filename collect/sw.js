/* 資料回収（顧問先の画面）：画面を 端末に置いておき、開いたら 通信を待たずに すぐ出す（2026-11-04）
   ・扱うのは 顧問先の画面（/apps/collect/ と index.html を開くとき）だけ。事務所の画面・LINE の入口・サーバ（script.google.com）・version.txt には 手を出さない
   ・ふだん … 置いてある画面を すぐ出し、うしろで 新しいものを取って 置き換える（次に開いたときは 新しい画面）
   ・?v= が付いているとき（［↻ 開き直す］・「新しくなりました」から開き直したとき） … 必ず 取りに行く（古い画面に戻らない）
   ・取りに行けないとき（電波なし）は 置いてある画面を出す
   ・中身（顧問先の資料・合図）は 置かない。置くのは 画面（HTML）だけ */
const CACHE = 'collect-page-v1';
const SCOPE = new URL(self.registration.scope);
const PAGE = new URL('index.html', SCOPE).href;

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE && k.indexOf('collect-page') === 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isPage(u) { return u.origin === SCOPE.origin && (u.pathname === SCOPE.pathname || u.pathname === SCOPE.pathname + 'index.html'); }
function fresh() {
  return fetch(PAGE, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) {
    if (r && r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE).then(function (ca) { return ca.put(PAGE, c); }).catch(function () {}); }
    return r;
  });
}
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const u = new URL(req.url);
  if (!isPage(u)) return;
  if (u.searchParams.has('v')) {
    e.respondWith(fresh().then(function (r) { return r && r.ok ? r : caches.match(PAGE).then(function (h) { return h || r; }); }, function () { return caches.match(PAGE).then(function (h) { return h || fetch(req); }); }));
    return;
  }
  e.respondWith(caches.match(PAGE).then(function (hit) {
    const up = fresh().catch(function () { return null; });
    if (hit) { e.waitUntil(up); return hit; }
    return up.then(function (r) { return r || fetch(req); });
  }));
});
