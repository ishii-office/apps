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

/* ★★★ 事務所の画面を閉じていても 担当者の端末に知らせる（Web プッシュ。2026-11-07）
   ・サーバからの知らせには 中身が無い。ここで 事務所の合図（collect_office_auth・IndexedDB）を持って サーバに「何が届いたか」を聞き、
     顧問先ごとに「📷 コード 名前 様から 届きました」を出す（事務所の画面が出すものと 同じ札＝tag なので 二重に並ばない）
   ・聞けなかったら（合図が切れた・電波が無い）「顧問先から 資料が届きました」だけ出す（知らせは 必ず1つ出す決まり）
   ・押すと 事務所の画面を開いて その顧問先の その箱を出す（開いていれば そこへ） */
function idbAuth(fn) {
  return new Promise(function (ok) {
    try {
      const r = indexedDB.open('collect_office_auth', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('a'); };
      r.onerror = function () { ok(null); };
      r.onsuccess = function () {
        try { const db = r.result, tx = db.transaction('a', 'readwrite'), st = tx.objectStore('a'); const q = fn(st); tx.oncomplete = function () { db.close(); ok(q && 'result' in q ? q.result : null); }; tx.onerror = tx.onabort = function () { db.close(); ok(null); }; }
        catch (e) { ok(null); }
      };
    } catch (e) { ok(null); }
  });
}
function askSrv(api, tok, fn, args) {
  return fetch(api, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: fn, args: args, tok: tok }) })
    .then(function (r) { return r.json(); }).then(function (o) { if (!o || !o.ok) throw new Error('ng'); return o.r; });
}
function officeUrl(code, box) { return new URL('office.html' + (code ? '?arr=' + encodeURIComponent(code) + (box ? '&box=' + encodeURIComponent(box) : '') : ''), SCOPE).href; }
async function onPush() {
  const shown = [];
  try {
    const a = await idbAuth(function (st) { return st.get('tok'); });
    const api = await idbAuth(function (st) { return st.get('api'); });
    const since = Number(await idbAuth(function (st) { return st.get('psince'); })) || Date.now() - 15 * 60000;
    if (a && a.tok && api) {
      const r = await askSrv(api, a.tok, 'arriveNews', [since, false]);
      if (r && r.t) await idbAuth(function (st) { return st.put(r.t, 'psince'); });
      for (const x of (r && r.items) || []) {
        shown.push(self.registration.showNotification('📷 ' + x.code + ' ' + x.name + ' 様から 届きました', { body: x.n + '件 届きました' + (x.box ? '（' + x.box + '）' : '') + '。押すと 回収資料を開きます。', tag: 'arr-' + x.code, icon: 'icon-192.png', data: { url: officeUrl(x.code, x.box) } }));
      }
      const lsince = Number(await idbAuth(function (st) { return st.get('lsince'); })) || since;
      const l = await askSrv(api, a.tok, 'lineNews', [lsince]).catch(function () { return null; });
      if (l && l.t) await idbAuth(function (st) { return st.put(l.t, 'lsince'); });
      for (const x of (l && l.items) || []) {
        shown.push(self.registration.showNotification('💬 ' + x.code + ' ' + x.name + ' 様から 公式LINEで届きました', { body: x.n + '件 届きました。押すと 事務所の画面を開きます。', tag: 'line-' + x.code, icon: 'icon-192.png', data: { url: officeUrl(x.code, '') } }));
      }
    }
  } catch (e) {}
  if (!shown.length) shown.push(self.registration.showNotification('📷 顧問先から 資料が届きました', { body: '押すと 事務所の画面を開きます。', tag: 'arr-any', icon: 'icon-192.png', data: { url: officeUrl('', '') } }));
  return Promise.all(shown);
}
self.addEventListener('push', function (e) { e.waitUntil(onPush()); });
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || officeUrl('', '');
  const u = new URL(url);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    const off = cs.find(function (c) { return /\/office\.html/.test(c.url); });
    if (off) { off.postMessage({ arr: u.searchParams.get('arr') || '', box: u.searchParams.get('box') || '' }); return off.focus(); }
    return self.clients.openWindow(url);
  }));
});
