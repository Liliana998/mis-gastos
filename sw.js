// Mis Gastos - service worker minimo (trasladado de Archivo de Comprobantes).
// Solo permite instalar la aplicacion. No guarda gastos, fotos,
// busquedas ni respuestas del servicio: todo se pide siempre a internet.
const VERSION_MG = 'mg-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function (e) {
  // Solo la propia pagina; nunca las consultas al servicio de Google.
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" ' +
      'content="width=device-width,initial-scale=1"><body style="font-family:' +
      'system-ui;background:#F3F5F1;color:#1F4D45;padding:32px;text-align:center">' +
      '<h2>Sin conexión</h2><p>Mis Gastos necesita internet.' +
      '</p><button onclick="location.reload()" style="height:48px;padding:0 24px;' +
      'border-radius:14px;border:none;background:#1F4D45;color:#fff;font-size:16px">' +
      'Reintentar</button></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
