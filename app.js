/**
 * Mis Gastos - aplicacion instalable v1
 * Acceso trasladado sin cambios de fondo de Archivo de Comprobantes v3:
 * identidad de Google (una vez por dispositivo) + llave del dispositivo
 * (30 dias) + PIN de 7 digitos cada vez que se abre. Los gastos y las fotos
 * viven en la cuenta de Google; en el dispositivo solo se guarda la llave.
 */
(function () {
  'use strict';

  var CFG = window.CONFIG_MG || {};
  var I = window.Interprete;
  var VISTAS = ['vistaInicio', 'vistaGoogle', 'vistaPin', 'vistaPrincipal', 'vistaEscribir',
    'vistaLeyendo', 'vistaRevision', 'vistaHistorial', 'vistaDetalle', 'vistaCategorias'];
  var LARGO_PIN = 7;
  // Prefijo propio: el almacenamiento local es comun a todas las aplicaciones
  // publicadas en liliana998.github.io (Comprobantes usa "ac_").
  var CLAVE_LLAVE = 'mg_llave_dispositivo';

  var est = {
    idToken: null, vence: 0, sesion: null, pinCreado: true, pin: '', pinPrimero: null,
    enviandoPin: false, esperaToken: null, ocultoDesde: 0, vistaPrevia: null,
    googleIniciado: false, llave: null,
    datos: null,            // { gastos, establecimientos, categorias } (en memoria)
    borrador: null,         // gasto en revision
    fotoLocal: null,        // URL local de la foto recien tomada
    categoriaTocada: false, // la propietaria eligio la categoria a mano
    dupConfirmado: false,
    periodo: 'mes',
    detalleId: null,
    reconocimiento: null
  };

  var FORMATO = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var NOMBRE_MEDIO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };

  /* ====================== UTILIDADES ====================== */

  function $(id) { return document.getElementById(id); }
  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function mostrar(vista) {
    VISTAS.forEach(function (v) { $(v).classList.toggle('oculto', v !== vista); });
    window.scrollTo(0, 0);
  }
  function vistaActual() {
    for (var i = 0; i < VISTAS.length; i++) if (!$(VISTAS[i]).classList.contains('oculto')) return VISTAS[i];
    return null;
  }
  function esperando(si) { $('cargando').classList.toggle('oculto', !si); }
  function dinero(n) { return FORMATO.format(Number(n) || 0); }
  function hoyIso() { return I.iso(new Date()); }
  function fechaLarga(iso) {
    var p = iso.split('-');
    return Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1] + ' de ' + p[0];
  }

  /* ====================== LLAVE DEL DISPOSITIVO ====================== */

  function leerLlave() {
    try {
      var v = localStorage.getItem(CLAVE_LLAVE);
      return /^[a-f0-9]{64}$/.test(v || '') ? v : null;
    } catch (e) { return null; }
  }
  function guardarLlave(v) {
    est.llave = v;
    try { localStorage.setItem(CLAVE_LLAVE, v); } catch (e) { /* sin almacenamiento */ }
  }
  function olvidarLlave() {
    est.llave = null;
    try { localStorage.removeItem(CLAVE_LLAVE); } catch (e) { /* nada */ }
  }

  /* ====================== SERVICIO ====================== */

  function configurada() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(CFG.API_URL || '') &&
        /\.apps\.googleusercontent\.com$/.test(CFG.ID_CLIENTE || '');
  }

  function llamar(accion, datos) {
    var cuerpo = Object.assign({ accion: accion, idToken: est.idToken, sesion: est.sesion }, datos || {});
    return fetch(CFG.API_URL, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita la consulta previa
      credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer'
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: 'red' };
      return r.json().catch(function () { return { ok: false, error: 'red' }; });
    }, function () { return { ok: false, error: 'red' }; });
  }

  function api(accion, datos) {
    var previo = (est.idToken && est.vence && est.vence - Date.now() < 120000)
        ? renovarIdentidad() : Promise.resolve(true);
    return previo.then(function () { return llamar(accion, datos); }).then(function (r) {
      if (!r.ok && r.error === 'identidad' && accion !== 'estado') {
        return renovarIdentidad().then(function (ok) { return ok ? llamar(accion, datos) : r; });
      }
      return r;
    });
  }

  // Devuelve true si el error ya se atendio (sesion o identidad).
  function manejarError(r, salida) {
    if (r.error === 'sesion') { est.sesion = null; abrirPin('Su sesión terminó. Ingrese su PIN.'); return true; }
    if (r.error === 'identidad') {
      est.idToken = null; est.sesion = null;
      pantallaGoogle('Vuelva a iniciar sesión con su cuenta de Google.');
      return true;
    }
    var texto = {
      red: 'No hay conexión con el servicio. Revise su internet e intente de nuevo.',
      config: 'El servicio aún no está configurado.',
      datos: 'Revise los datos: falta el importe, el establecimiento o la fecha.',
      ocupado: 'El servicio está ocupado. Intente de nuevo en unos segundos.',
      noExiste: 'Ese gasto ya no existe (quizá se eliminó en otro dispositivo).',
      interno: 'Error del servicio: ' + (r.mensaje || 'sin detalle') + '.'
    }[r.error] || 'No se pudo completar la operación.';
    if (salida) salida(texto);
    return false;
  }

  /* ====================== IDENTIDAD DE GOOGLE ====================== */

  function leerJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch (e) { return {}; }
  }

  function iniciarGoogle() {
    if (est.googleIniciado || !window.google || !google.accounts) return;
    est.googleIniciado = true;
    google.accounts.id.initialize({
      client_id: CFG.ID_CLIENTE, callback: recibirCredencial, auto_select: true,
      cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true, context: 'signin'
    });
    google.accounts.id.renderButton($('botonGoogle'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 260
    });
    google.accounts.id.prompt();
    setTimeout(function () { if (!est.idToken && vistaActual() === 'vistaInicio') pantallaGoogle(); }, 2500);
  }

  function iniciarFlujoGoogle(mensaje) {
    est.sesion = null;
    if (est.googleIniciado) {
      pantallaGoogle(mensaje);
      try { google.accounts.id.prompt(); } catch (e) { /* nada */ }
      return;
    }
    $('inicioMensaje').textContent = 'Verificando su cuenta...';
    mostrar('vistaInicio');
    if (mensaje) setTimeout(function () {
      if (!est.idToken && vistaActual() !== 'vistaPin') pantallaGoogle(mensaje);
    }, 2600);
    if (window.google && google.accounts) iniciarGoogle(); else window.onGoogleLibraryLoad = iniciarGoogle;
    setTimeout(function () {
      if (!est.googleIniciado) {
        $('inicioMensaje').textContent = 'No se pudo conectar con Google. Revise su internet y vuelva a abrir la aplicación.';
      }
    }, 12000);
  }

  function pantallaGoogle(mensaje) {
    var aviso = $('googleMensaje');
    aviso.textContent = mensaje || '';
    aviso.classList.toggle('oculto', !mensaje);
    mostrar('vistaGoogle');
  }

  function recibirCredencial(resp) {
    var token = resp && resp.credential;
    if (!token) return;
    est.idToken = token;
    est.vence = Number(leerJwt(token).exp || 0) * 1000;
    if (est.esperaToken) { var listo = est.esperaToken; est.esperaToken = null; listo(true); return; }
    consultarEstado();
  }

  function renovarIdentidad() {
    if (!window.google || !google.accounts) return Promise.resolve(false);
    return new Promise(function (resolver) {
      est.esperaToken = resolver;
      try { google.accounts.id.prompt(); } catch (e) { /* sin efecto */ }
      setTimeout(function () {
        if (est.esperaToken === resolver) { est.esperaToken = null; resolver(false); }
      }, 10000);
    });
  }

  function consultarEstado() {
    $('inicioMensaje').textContent = 'Verificando su cuenta...';
    mostrar('vistaInicio');
    llamar('estado').then(function (r) {
      if (r.ok) { est.pinCreado = !!r.pinCreado; abrirPin(); return; }
      if (r.error === 'identidad') {
        est.idToken = null;
        try { google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
        pantallaGoogle('Esta cuenta de Google no tiene acceso. Elija la cuenta propietaria.');
        return;
      }
      manejarError(r, function (t) { pantallaGoogle(t); });
    });
  }

  /* ====================== PIN ====================== */

  function construirTeclado() {
    for (var i = 0; i < LARGO_PIN; i++) $('puntos').appendChild(el('span'));
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Borrar'].forEach(function (t) {
      var b = el('button', t === '' ? 'vacio' : (t === 'Borrar' ? 'borrar' : ''), t);
      b.type = 'button';
      b.addEventListener('click', function () { if (t === 'Borrar') borrarDigito(); else if (t) agregarDigito(t); });
      $('teclado').appendChild(b);
    });
    document.addEventListener('keydown', function (ev) {
      if (vistaActual() !== 'vistaPin') return;
      if (/^\d$/.test(ev.key)) agregarDigito(ev.key);
      else if (ev.key === 'Backspace') borrarDigito();
    });
    $('btnOtraCuenta').addEventListener('click', function () {
      est.idToken = null; est.sesion = null; olvidarLlave();
      try { google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
      iniciarFlujoGoogle();
    });
  }

  function pintarPuntos() {
    var s = $('puntos').children;
    for (var i = 0; i < s.length; i++) s[i].classList.toggle('lleno', i < est.pin.length);
  }

  function textosPin() {
    if (est.pinCreado) { $('pinTitulo').textContent = 'Ingrese su PIN'; $('pinTexto').textContent = 'Clave de acceso de 7 dígitos.'; }
    else if (est.pinPrimero === null) {
      $('pinTitulo').textContent = 'Cree su PIN';
      $('pinTexto').textContent = 'Elija una clave de 7 dígitos. Se pedirá cada vez que abra la aplicación.';
    } else { $('pinTitulo').textContent = 'Repita su PIN'; $('pinTexto').textContent = 'Escriba la misma clave para confirmarla.'; }
  }

  function abrirPin(mensaje) {
    est.pin = ''; est.pinPrimero = null; est.enviandoPin = false;
    textosPin(); pintarPuntos();
    $('pinMensaje').textContent = mensaje || '';
    mostrar('vistaPin');
  }

  function errorPin(texto) {
    var p = $('puntos');
    p.classList.remove('error'); void p.offsetWidth; p.classList.add('error');
    $('pinMensaje').textContent = texto;
    est.pin = ''; pintarPuntos();
  }

  function agregarDigito(d) {
    if (est.enviandoPin || est.pin.length >= LARGO_PIN) return;
    est.pin += d; $('pinMensaje').textContent = ''; pintarPuntos();
    if (est.pin.length === LARGO_PIN) setTimeout(completarPin, 120);
  }
  function borrarDigito() { if (est.enviandoPin) return; est.pin = est.pin.slice(0, -1); pintarPuntos(); }
  function pinDebil(pin) {
    return /^(\d)\1+$/.test(pin) || '01234567890'.indexOf(pin) !== -1 || '09876543210'.indexOf(pin) !== -1;
  }

  function completarPin() {
    var pin = est.pin;
    if (!est.pinCreado) {
      if (est.pinPrimero === null) {
        if (pinDebil(pin)) { errorPin('Ese PIN es demasiado fácil de adivinar. Elija otro.'); return; }
        est.pinPrimero = pin; est.pin = ''; textosPin(); pintarPuntos(); return;
      }
      if (pin !== est.pinPrimero) { est.pinPrimero = null; textosPin(); errorPin('Los PIN no coinciden. Empiece de nuevo.'); return; }
      enviarPin('crearPin', pin);
      return;
    }
    enviarPin('entrar', pin);
  }

  function enviarPin(accion, pin) {
    est.enviandoPin = true;
    $('pinMensaje').textContent = 'Verificando...';
    var conLlave = accion === 'entrar' && est.llave && !est.idToken;
    var peticion = conLlave ? api('entrarDispositivo', { pin: pin, llave: est.llave })
                            : api(accion, { pin: pin, recordar: true });
    peticion.then(function (r) {
      est.enviandoPin = false; est.pin = '';
      if (r.ok && r.sesion) {
        if (r.llave) guardarLlave(r.llave);
        est.sesion = r.sesion; est.pinCreado = true; est.pinPrimero = null;
        $('pinMensaje').textContent = ''; pintarPuntos();
        entrarALaApp();
        return;
      }
      if (r.error === 'pin') errorPin('PIN incorrecto. ' + (r.restantes === 1 ? 'Le queda 1 intento.' : 'Le quedan ' + r.restantes + ' intentos.'));
      else if (r.error === 'bloqueado') errorPin('Demasiados intentos. Espere ' + r.minutos + (r.minutos === 1 ? ' minuto.' : ' minutos.'));
      else if (r.error === 'sinPin') { est.pinCreado = false; abrirPin('Todavía no hay un PIN. Cree uno.'); }
      else if (r.error === 'pinExiste') { est.pinCreado = true; abrirPin('Ya existe un PIN. Ingréselo.'); }
      else if (r.error === 'formatoPin') errorPin('El PIN debe tener 7 dígitos.');
      else if (r.error === 'llave') { olvidarLlave(); iniciarFlujoGoogle('Por seguridad, vuelva a iniciar sesión con Google.'); }
      else manejarError(r, errorPin);
    });
  }

  function entrarALaApp() {
    var destino = est.vistaPrevia || 'vistaPrincipal';
    est.vistaPrevia = null;
    mostrar(destino);
    cargarDatos();
  }

  // Cierra la sesion y vuelve al PIN. No borra la identidad de Google.
  function bloquear(volverDespues) {
    if (est.sesion) llamar('salir');
    est.sesion = null;
    var v = vistaActual();
    est.vistaPrevia = volverDespues && ['vistaRevision', 'vistaHistorial', 'vistaDetalle'].indexOf(v) !== -1 ? v : null;
    if (!est.vistaPrevia) { est.datos = null; $('lista').innerHTML = ''; $('detalle').innerHTML = ''; }
    detenerDictado();
    abrirPin();
  }

  /* ====================== DATOS ====================== */

  function cargarDatos() {
    return api('datos').then(function (r) {
      if (r.ok) {
        est.datos = r.datos;
        prepararCatalogos();
        if (vistaActual() === 'vistaHistorial') pintarHistorial();
        return true;
      }
      manejarError(r, function (t) { avisoInicio(t, true); });
      return false;
    });
  }

  function catalogo() { return (est.datos && est.datos.establecimientos) || []; }
  function categorias() {
    return ((est.datos && est.datos.categorias) || []).slice().sort(function (a, b) { return a.localeCompare(b, 'es'); });
  }

  function prepararCatalogos() {
    var dl = $('listaEstab');
    dl.innerHTML = '';
    var vistos = {};
    catalogo().concat((est.datos.gastos || []).map(function (g) { return { nombre: g.establecimiento }; }))
      .forEach(function (e) {
        var k = I.clave(e.nombre);
        if (!k || vistos[k]) return;
        vistos[k] = true;
        var o = el('option'); o.value = e.nombre; dl.appendChild(o);
      });
  }

  function ultimoMedio() {
    var g = ((est.datos && est.datos.gastos) || []).filter(function (x) { return x.medio; })
      .sort(function (a, b) { return (b.creado || '').localeCompare(a.creado || ''); })[0];
    return g ? g.medio : '';
  }

  function habitualDe(nombre) {
    var e = I.buscarEnCatalogo(nombre, catalogo());
    return e && I.clave(e.nombre) === I.clave(nombre) ? e : null;
  }

  function avisoInicio(texto, esError) {
    var a = $('avisoGuardado');
    a.textContent = texto;
    a.style.background = esError ? 'var(--error-bg)' : '';
    a.style.color = esError ? 'var(--error)' : '';
    a.classList.remove('oculto');
    clearTimeout(avisoInicio.t);
    avisoInicio.t = setTimeout(function () { a.classList.add('oculto'); }, esError ? 8000 : 5000);
  }

  /* ====================== FOTOGRAFIAR ====================== */

  // Reduce la foto (lado mayor 2000 px, JPEG) para enviarla rapido sin perder legibilidad.
  function comprimir(archivo) {
    var cargar = window.createImageBitmap ? createImageBitmap(archivo) : new Promise(function (ok, mal) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = mal;
      img.src = URL.createObjectURL(archivo);
    });
    return cargar.then(function (img) {
      var max = 2000, w = img.width, h = img.height, f = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * f); c.height = Math.round(h * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.85); });
    });
  }

  function aBase64(blob) {
    return new Promise(function (ok, mal) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1]); };
      r.onerror = mal;
      r.readAsDataURL(blob);
    });
  }

  function procesarFoto(ev) {
    var archivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    mostrar('vistaLeyendo');
    comprimir(archivo).then(function (blob) {
      if (est.fotoLocal) URL.revokeObjectURL(est.fotoLocal);
      est.fotoLocal = URL.createObjectURL(blob);
      return aBase64(blob);
    }).then(function (b64) {
      return api('ocr', { imagen: b64, tipo: 'image/jpeg' });
    }).then(function (r) {
      if (!r.ok) {
        if (manejarError(r, function (t) { mostrar('vistaPrincipal'); avisoInicio(t, true); })) return;
        return;
      }
      var p = I.interpretarTicket(r.datos.texto || '', { catalogo: catalogo() });
      var aviso = !r.datos.texto ? 'No se pudo leer el ticket. Complete los datos; la foto se conservará.' :
          avisoDudas(p);
      abrirRevision({ fecha: p.fecha, establecimiento: p.establecimiento, importe: p.importe,
        medio: p.medio, fotoId: r.datos.fotoId, origen: 'foto' }, aviso, p.dudas);
    }).catch(function () {
      mostrar('vistaPrincipal');
      avisoInicio('No se pudo procesar la fotografía. Intente de nuevo.', true);
    });
  }

  function avisoDudas(p) {
    var partes = [];
    if (p.faltan.indexOf('importe') !== -1) partes.push('el importe');
    else if (p.dudas.indexOf('importe') !== -1) partes.push('el importe (no se encontró la palabra «total»)');
    if (p.faltan.indexOf('establecimiento') !== -1) partes.push('el establecimiento');
    if (p.faltan.indexOf('fecha') !== -1) partes.push('la fecha (se puso la de hoy)');
    return partes.length ? 'Revise ' + partes.join(', ') + '.' : '';
  }

  /* ====================== DICTAR / ESCRIBIR ====================== */

  function abrirEscribir(dictando) {
    $('frase').value = '';
    $('escribirTitulo').textContent = dictando ? 'Dictar un gasto' : 'Escribir un gasto';
    $('escuchando').classList.add('oculto');
    $('escribirAyuda').textContent = 'Incluya el importe y el lugar. La fecha y el medio de pago son opcionales: ' +
        '«hoy», «ayer», «el 17 de octubre», «en efectivo», «con tarjeta».';
    mostrar('vistaEscribir');
  }

  function dictar() {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    abrirEscribir(true);
    if (!Rec) { alternativaTeclado(); return; }
    var rec = new Rec();
    est.reconocimiento = rec;
    rec.lang = 'es-MX';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    var final = '';
    var fallo = null;
    rec.onresult = function (e) {
      var parcial = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else parcial += e.results[i][0].transcript;
      }
      $('frase').value = (final + ' ' + parcial).trim();
    };
    rec.onerror = function (e) { fallo = e.error; };
    rec.onend = function () {
      est.reconocimiento = null;
      $('escuchando').classList.add('oculto');
      if (vistaActual() !== 'vistaEscribir') return;
      if (final.trim()) { interpretarFrase('voz'); return; }
      if (fallo === 'not-allowed' || fallo === 'service-not-allowed') {
        alternativaTeclado('El navegador no tiene permiso para usar el micrófono.');
      } else if (fallo === 'no-speech' || !fallo) {
        $('escribirAyuda').textContent = 'No se escuchó nada. Toque «Dictar» de nuevo o use el micrófono del teclado.';
      } else {
        alternativaTeclado('El dictado no está disponible en este momento.');
      }
    };
    try {
      rec.start();
      $('escuchando').classList.remove('oculto');
    } catch (e) {
      est.reconocimiento = null;
      alternativaTeclado();
    }
  }

  // Alternativa universal: el micrófono del teclado (Samsung o Gboard).
  function alternativaTeclado(motivo) {
    $('escribirAyuda').textContent = (motivo ? motivo + ' ' : '') +
        'Toque el micrófono del teclado y diga su gasto; después pulse «Continuar».';
    $('frase').focus();
  }

  function detenerDictado() {
    if (est.reconocimiento) { try { est.reconocimiento.abort(); } catch (e) { /* nada */ } est.reconocimiento = null; }
  }

  function interpretarFrase(origen) {
    var texto = $('frase').value.trim();
    if (!texto) { $('frase').focus(); return; }
    var p = I.interpretarFrase(texto, { catalogo: catalogo() });
    var faltan = [];
    if (p.faltan.indexOf('importe') !== -1) faltan.push('el importe');
    if (p.faltan.indexOf('establecimiento') !== -1) faltan.push('el establecimiento o concepto');
    abrirRevision({ fecha: p.fecha, establecimiento: p.establecimiento, importe: p.importe,
      medio: p.medio, fotoId: '', origen: origen || 'texto' },
      faltan.length ? 'Complete ' + faltan.join(' y ') + '.' : '', []);
  }

  /* ====================== REVISION ====================== */

  function abrirRevision(g, aviso, dudas) {
    var conocido = g.establecimiento ? I.buscarEnCatalogo(g.establecimiento, catalogo()) : null;
    if (conocido) g.establecimiento = conocido.nombre;
    est.borrador = g;
    est.categoriaTocada = false;
    est.dupConfirmado = false;
    $('revisionTitulo').textContent = g.id ? 'Editar gasto' : 'Revise y guarde';
    $('gImporte').value = g.importe ? Number(g.importe).toFixed(2) : '';
    $('gEstab').value = g.establecimiento || '';
    $('gFecha').value = g.fecha || hoyIso();
    $('gFecha').max = hoyIso();
    $('gImporte').parentNode.classList.toggle('dudoso', (dudas || []).indexOf('importe') !== -1 || !g.importe);
    $('gFecha').classList.toggle('dudoso', (dudas || []).indexOf('fecha') !== -1);
    $('gEstab').classList.toggle('dudoso', !g.establecimiento);
    llenarCategorias(g.id ? g.categoria : (conocido && conocido.categoria) || '');
    pintarMedio(g.id ? g.medio : (g.medio || ultimoMedio()));
    var av = $('revisionAviso');
    av.textContent = aviso || '';
    av.classList.toggle('oculto', !aviso);
    $('duplicado').classList.add('oculto');
    $('revisionError').textContent = '';
    pintarFotoRevision();
    actualizarRecordar();
    mostrar('vistaRevision');
    if (!g.importe) setTimeout(function () { $('gImporte').focus(); }, 50);
    else if (!g.establecimiento) setTimeout(function () { $('gEstab').focus(); }, 50);
  }

  function pintarFotoRevision() {
    var caja = $('revisionFoto');
    var img = caja.querySelector('img');
    var g = est.borrador;
    if (!g.fotoId) { caja.classList.add('oculto'); img.removeAttribute('src'); return; }
    caja.classList.remove('oculto');
    if (g.origen === 'foto' && !g.id && est.fotoLocal) { img.src = est.fotoLocal; return; }
    img.removeAttribute('src');
    cargarFoto(g.fotoId).then(function (url) { if (url) img.src = url; });
  }

  function llenarCategorias(seleccion) {
    var s = $('gCategoria');
    s.innerHTML = '';
    s.appendChild(new Option('Sin categoría', ''));
    categorias().forEach(function (c) { s.appendChild(new Option(c, c)); });
    if (seleccion && categorias().indexOf(seleccion) === -1) s.appendChild(new Option(seleccion, seleccion));
    s.appendChild(new Option('+ Nueva categoría…', '__nueva'));
    s.value = seleccion || '';
    $('gCategoriaNueva').classList.add('oculto');
    $('gCategoriaNueva').value = '';
  }

  function categoriaElegida() {
    var v = $('gCategoria').value;
    if (v === '__nueva') return $('gCategoriaNueva').value.replace(/\s+/g, ' ').trim();
    return v;
  }

  function pintarMedio(medio) {
    est.borrador.medio = medio || '';
    Array.prototype.forEach.call($('medios').children, function (b) {
      b.classList.toggle('activo', b.getAttribute('data-medio') === est.borrador.medio);
    });
  }

  // Casilla "usar como categoria habitual": marcada si el establecimiento no
  // tiene habitual; desmarcada si se eligio otra distinta para este gasto.
  function actualizarRecordar() {
    var nombre = $('gEstab').value.trim();
    var cat = categoriaElegida();
    var fila = $('recordarFila');
    if (!nombre || !cat) { fila.classList.add('oculto'); return; }
    var hab = habitualDe(nombre);
    if (hab && hab.categoria === cat) { fila.classList.add('oculto'); $('gRecordar').checked = false; return; }
    fila.classList.remove('oculto');
    $('recordarTexto').textContent = hab && hab.categoria
        ? 'Cambiar la categoría habitual de ' + nombre + ' a «' + cat + '» (ahora: ' + hab.categoria + ')'
        : 'Recordar «' + cat + '» para ' + nombre;
    $('gRecordar').checked = !(hab && hab.categoria);
  }

  function alCambiarEstablecimiento() {
    $('gEstab').classList.remove('dudoso');
    if (!est.categoriaTocada && !(est.borrador && est.borrador.id)) {
      var hab = habitualDe($('gEstab').value.trim()) ||
          I.buscarEnCatalogo($('gEstab').value.trim(), catalogo());
      if (hab && hab.categoria) llenarCategorias(hab.categoria);
    }
    actualizarRecordar();
  }

  function leerFormulario() {
    var g = est.borrador;
    var importe = I.aNumero(($('gImporte').value || '').replace(/[^\d.,]/g, ''));
    return {
      id: g.id || '', fecha: $('gFecha').value, establecimiento: $('gEstab').value.replace(/\s+/g, ' ').trim(),
      importe: isNaN(importe) ? 0 : Math.round(importe * 100) / 100, categoria: categoriaElegida(),
      medio: g.medio || '', fotoId: g.fotoId || '', origen: g.origen || 'manual'
    };
  }

  function guardar(ev) {
    ev.preventDefault();
    var g = leerFormulario();
    var err = $('revisionError');
    if (!(g.importe > 0)) { err.textContent = 'Indique el importe.'; $('gImporte').focus(); return; }
    if (!g.establecimiento) { err.textContent = 'Indique el establecimiento o concepto.'; $('gEstab').focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha)) { err.textContent = 'Indique la fecha.'; return; }
    if ($('gCategoria').value === '__nueva' && !g.categoria) { err.textContent = 'Escriba el nombre de la nueva categoría.'; $('gCategoriaNueva').focus(); return; }
    err.textContent = '';
    if (!est.dupConfirmado) {
      var dups = I.posiblesDuplicados(g, (est.datos && est.datos.gastos) || []);
      if (dups.length) { mostrarDuplicado(dups); return; }
    }
    var recordar = !$('recordarFila').classList.contains('oculto') && $('gRecordar').checked;
    $('btnGuardar').disabled = true;
    esperando(true);
    api('guardar', { gasto: g, recordarCategoria: recordar }).then(function (r) {
      esperando(false);
      $('btnGuardar').disabled = false;
      if (!r.ok) { if (!manejarError(r, function (t) { err.textContent = t; })) return; return; }
      aplicarGuardado(r.datos, recordar);
      var editado = !!g.id;
      est.borrador = null;
      if (editado) { abrirDetalle(r.datos.id); return; }
      mostrar('vistaPrincipal');
      avisoInicio('Guardado: ' + r.datos.establecimiento + ' · ' + dinero(r.datos.importe) +
          (r.datos.fecha === hoyIso() ? ' · hoy' : ' · ' + fechaLarga(r.datos.fecha)));
    });
  }

  // Actualiza la copia en memoria sin volver a pedir todo al servicio.
  function aplicarGuardado(g, recordar) {
    var d = est.datos || (est.datos = { gastos: [], establecimientos: [], categorias: [] });
    var i = d.gastos.findIndex(function (x) { return x.id === g.id; });
    if (i === -1) d.gastos.push(g); else d.gastos[i] = g;
    if (g.categoria && d.categorias.indexOf(g.categoria) === -1) d.categorias.push(g.categoria);
    if (recordar) {
      var k = I.clave(g.establecimiento);
      var j = d.establecimientos.findIndex(function (e) { return e.clave === k; });
      var e = { clave: k, nombre: g.establecimiento, categoria: g.categoria };
      if (j === -1) d.establecimientos.push(e); else d.establecimientos[j] = e;
    }
    prepararCatalogos();
  }

  function mostrarDuplicado(dups) {
    var caja = $('duplicado');
    caja.innerHTML = '';
    caja.appendChild(el('b', '', 'Posible gasto repetido. '));
    caja.appendChild(document.createTextNode('Ya existe: ' + dups.slice(0, 3).map(function (d) {
      return d.establecimiento + ', ' + dinero(d.importe) + ', ' + fechaLarga(d.fecha);
    }).join('; ') + '.'));
    var acc = el('div', 'acciones');
    var si = el('button', 'primario', 'Guardar de todos modos');
    si.type = 'button';
    si.addEventListener('click', function () {
      est.dupConfirmado = true; caja.classList.add('oculto');
      $('formGasto').requestSubmit ? $('formGasto').requestSubmit() : guardar({ preventDefault: function () {} });
    });
    var no = el('button', 'secundario', 'No guardar');
    no.type = 'button';
    no.addEventListener('click', cancelarRevision);
    acc.appendChild(si); acc.appendChild(no);
    caja.appendChild(acc);
    caja.classList.remove('oculto');
    caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Al cancelar un gasto nuevo con foto, la foto va a la papelera de Drive.
  function cancelarRevision() {
    var g = est.borrador;
    if (g && !g.id && g.fotoId) llamar('descartarFoto', { fotoId: g.fotoId });
    var editando = g && g.id;
    est.borrador = null;
    if (editando) abrirDetalle(g.id); else mostrar('vistaPrincipal');
  }

  /* ====================== HISTORIAL ====================== */

  function abrirHistorial() {
    mostrar('vistaHistorial');
    pintarFiltros();
    pintarHistorial();
    cargarDatos(); // refresca con lo registrado en otros dispositivos
  }

  function pintarFiltros() {
    Array.prototype.forEach.call($('periodos').children, function (b) {
      b.classList.toggle('activo', b.getAttribute('data-periodo') === est.periodo);
    });
    $('rango').classList.toggle('oculto', est.periodo !== 'fechas');
    var s = $('hCategoria'), actual = s.options.length ? s.value : '*';
    s.innerHTML = '';
    s.appendChild(new Option('Todas las categorías', '*'));
    s.appendChild(new Option('Sin categoría', ''));
    categorias().forEach(function (c) { s.appendChild(new Option(c, c)); });
    s.value = Array.prototype.some.call(s.options, function (o) { return o.value === actual; }) ? actual : '*';
  }

  function rangoPeriodo() {
    var h = new Date(), a = h.getFullYear(), m = h.getMonth();
    var d = function (x) { return I.iso(x); };
    switch (est.periodo) {
      case 'hoy': return [hoyIso(), hoyIso()];
      case 'mes': return [d(new Date(a, m, 1)), d(new Date(a, m + 1, 0))];
      case 'mesAnterior': return [d(new Date(a, m - 1, 1)), d(new Date(a, m, 0))];
      case 'anio': return [a + '-01-01', a + '-12-31'];
      case 'fechas': return [$('hDesde').value || '0000-01-01', $('hHasta').value || '9999-12-31'];
      default: return ['0000-01-01', '9999-12-31'];
    }
  }

  function filtrados() {
    var gastos = (est.datos && est.datos.gastos) || [];
    var r = rangoPeriodo();
    var q = I.norm($('hBuscar').value);
    var cat = $('hCategoria').value;
    return gastos.filter(function (g) {
      if (g.fecha < r[0] || g.fecha > r[1]) return false;
      if (cat !== '*' && g.categoria !== cat) return false;
      if (q && I.norm(g.establecimiento).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || '');
    });
  }

  function pintarHistorial() {
    var lista = $('lista');
    lista.innerHTML = '';
    if (!est.datos) { lista.appendChild(el('div', 'vacio', 'Cargando…')); $('resumen').innerHTML = ''; return; }
    var gs = filtrados();
    var suma = gs.reduce(function (s, g) { return s + Number(g.importe); }, 0);
    $('resumen').innerHTML = '';
    $('resumen').appendChild(el('span', '', gs.length + (gs.length === 1 ? ' gasto' : ' gastos')));
    $('resumen').appendChild(el('b', '', dinero(suma)));
    if (!gs.length) {
      lista.appendChild(el('div', 'vacio', (est.datos.gastos || []).length ?
          'No hay gastos con estos filtros.' : 'Todavía no hay gastos registrados.'));
      return;
    }
    var grupo = null, caja = null;
    gs.forEach(function (g) {
      var mes = g.fecha.slice(0, 7);
      if (mes !== grupo) {
        grupo = mes;
        var delMes = gs.filter(function (x) { return x.fecha.slice(0, 7) === mes; })
            .reduce(function (s, x) { return s + Number(x.importe); }, 0);
        var cab = el('div', 'mes');
        cab.appendChild(el('span', '', MESES[Number(mes.slice(5)) - 1] + ' ' + mes.slice(0, 4)));
        cab.appendChild(el('span', '', dinero(delMes)));
        lista.appendChild(cab);
        caja = el('div', 'lista');
        lista.appendChild(caja);
      }
      var fila = el('div', 'mov');
      var dia = el('div', 'dia');
      dia.appendChild(el('b', '', String(Number(g.fecha.slice(8)))));
      dia.appendChild(el('span', '', MESES[Number(g.fecha.slice(5, 7)) - 1].slice(0, 3)));
      var centro = el('div');
      centro.appendChild(el('div', 'quien', g.establecimiento));
      var chips = el('div', 'chips');
      if (g.categoria) chips.appendChild(el('span', 'chip categ', g.categoria));
      if (g.medio) chips.appendChild(el('span', 'chip', NOMBRE_MEDIO[g.medio] || g.medio));
      if (g.fotoId) chips.appendChild(el('span', 'chip', 'Foto'));
      if (chips.children.length) centro.appendChild(chips);
      fila.appendChild(dia); fila.appendChild(centro);
      fila.appendChild(el('div', 'monto', dinero(g.importe)));
      fila.addEventListener('click', function () { abrirDetalle(g.id); });
      caja.appendChild(fila);
    });
  }

  /* ====================== DETALLE ====================== */

  var fotosCache = {};
  function cargarFoto(id) {
    if (fotosCache[id]) return Promise.resolve(fotosCache[id]);
    return api('foto', { fotoId: id }).then(function (r) {
      if (!r.ok) return null;
      var bytes = atob(r.datos.datos), arr = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      fotosCache[id] = URL.createObjectURL(new Blob([arr], { type: r.datos.tipo }));
      return fotosCache[id];
    });
  }

  function gastoPorId(id) {
    return ((est.datos && est.datos.gastos) || []).filter(function (g) { return g.id === id; })[0];
  }

  function abrirDetalle(id) {
    var g = gastoPorId(id);
    if (!g) { abrirHistorial(); return; }
    est.detalleId = id;
    var d = $('detalle');
    d.innerHTML = '';
    var cab = el('div', 'detalleCab');
    cab.appendChild(el('div', 'importe', dinero(g.importe)));
    cab.appendChild(el('div', 'quien', g.establecimiento));
    cab.appendChild(el('div', 'fecha', fechaLarga(g.fecha)));
    d.appendChild(cab);
    var datos = el('div', 'datos');
    [['Categoría', g.categoria || 'Sin categoría'], ['Medio de pago', NOMBRE_MEDIO[g.medio] || 'No indicado'],
     ['Registrado por', { foto: 'Fotografía', voz: 'Dictado', texto: 'Texto', manual: 'Captura manual' }[g.origen] || '—']]
      .forEach(function (p) {
        var f = el('div'); f.appendChild(el('span', '', p[0])); f.appendChild(el('b', '', p[1])); datos.appendChild(f);
      });
    d.appendChild(datos);
    if (g.fotoId) {
      var foto = el('div', 'fotoDetalle', 'Cargando fotografía…');
      d.appendChild(foto);
      cargarFoto(g.fotoId).then(function (url) {
        foto.textContent = '';
        if (!url) { foto.textContent = 'No se encontró la fotografía en Drive.'; return; }
        var img = el('img'); img.src = url; img.alt = 'Fotografía del ticket';
        img.addEventListener('click', function () { window.open(url, '_blank'); });
        foto.appendChild(img);
      });
    }
    var bot = el('div', 'botones');
    var editar = el('button', 'secundario', 'Editar');
    editar.type = 'button';
    editar.addEventListener('click', function () {
      abrirRevision(Object.assign({}, g), '', []);
    });
    var borrar = el('button', 'secundario peligro', 'Eliminar');
    borrar.type = 'button';
    borrar.addEventListener('click', function () { eliminar(g); });
    bot.appendChild(editar); bot.appendChild(borrar);
    d.appendChild(bot);
    mostrar('vistaDetalle');
  }

  function eliminar(g) {
    if (!window.confirm('¿Eliminar este gasto de ' + dinero(g.importe) + ' en ' + g.establecimiento + '?' +
        (g.fotoId ? '\nLa fotografía irá a la papelera de Drive.' : ''))) return;
    esperando(true);
    api('eliminar', { id: g.id }).then(function (r) {
      esperando(false);
      if (!r.ok && r.error !== 'noExiste') { if (!manejarError(r, function (t) { window.alert(t); })) return; return; }
      est.datos.gastos = est.datos.gastos.filter(function (x) { return x.id !== g.id; });
      abrirHistorial();
    });
  }

  /* ====================== CATEGORIAS ====================== */

  function abrirCategorias() {
    var caja = $('listaCategorias');
    caja.innerHTML = '';
    var cats = categorias();
    if (!cats.length) { caja.appendChild(el('div', 'vacio', 'Aún no hay categorías.')); mostrar('vistaCategorias'); return; }
    var lista = el('div', 'lista');
    cats.forEach(function (c) {
      var usos = est.datos.gastos.filter(function (g) { return g.categoria === c; }).length;
      var fila = el('div', 'cat');
      var nombre = el('div', 'nombre', c + ' ');
      nombre.appendChild(el('i', '', '· ' + usos + (usos === 1 ? ' gasto' : ' gastos')));
      var ren = el('button', 'secundario', 'Renombrar');
      ren.type = 'button';
      ren.addEventListener('click', function () { renombrar(fila, c); });
      fila.appendChild(nombre); fila.appendChild(ren);
      if (!usos) {
        var quitar = el('button', 'secundario peligro', 'Quitar');
        quitar.type = 'button';
        quitar.addEventListener('click', function () { quitarCategoria(c); });
        fila.appendChild(quitar);
      }
      lista.appendChild(fila);
    });
    caja.appendChild(lista);
    mostrar('vistaCategorias');
  }

  function renombrar(fila, anterior) {
    fila.innerHTML = '';
    var input = el('input'); input.value = anterior; input.maxLength = 60;
    var ok = el('button', 'primario', 'Guardar'); ok.type = 'button';
    var no = el('button', 'secundario', 'Cancelar'); no.type = 'button';
    no.addEventListener('click', abrirCategorias);
    ok.addEventListener('click', function () {
      var nueva = input.value.replace(/\s+/g, ' ').trim();
      if (!nueva || nueva === anterior) { abrirCategorias(); return; }
      esperando(true);
      api('renombrarCategoria', { anterior: anterior, nueva: nueva }).then(function (r) {
        if (!r.ok) { esperando(false); if (!manejarError(r, function (t) { window.alert(t); })) return; return; }
        cargarDatos().then(function () { esperando(false); abrirCategorias(); });
      });
    });
    fila.appendChild(input); fila.appendChild(ok); fila.appendChild(no);
    input.focus();
  }

  function quitarCategoria(c) {
    if (!window.confirm('¿Quitar la categoría «' + c + '»?')) return;
    esperando(true);
    api('eliminarCategoria', { categoria: c }).then(function (r) {
      if (!r.ok) { esperando(false); if (!manejarError(r, function (t) { window.alert(t); })) return; return; }
      cargarDatos().then(function () { esperando(false); abrirCategorias(); });
    });
  }

  /* ====================== EVENTOS ====================== */

  var ACCIONES = {
    bloquear: function () { bloquear(false); },
    fotografiar: function () { $('camara').click(); },
    galeria: function () { $('galeria').click(); },
    dictar: dictar,
    escribir: function () { abrirEscribir(false); setTimeout(function () { $('frase').focus(); }, 50); },
    inicio: function () { detenerDictado(); mostrar('vistaPrincipal'); },
    interpretar: function () {
      detenerDictado();
      interpretarFrase($('escribirTitulo').textContent.indexOf('Dictar') === 0 ? 'voz' : 'texto');
    },
    manual: function () {
      detenerDictado();
      abrirRevision({ fecha: hoyIso(), establecimiento: '', importe: null, medio: '', fotoId: '', origen: 'manual' }, '', []);
    },
    cancelarRevision: cancelarRevision,
    historial: abrirHistorial,
    categorias: abrirCategorias
  };

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (b && ACCIONES[b.getAttribute('data-accion')]) ACCIONES[b.getAttribute('data-accion')]();
  });
  $('camara').addEventListener('change', procesarFoto);
  $('galeria').addEventListener('change', procesarFoto);
  $('formGasto').addEventListener('submit', guardar);
  $('gEstab').addEventListener('change', alCambiarEstablecimiento);
  $('gEstab').addEventListener('input', function () { $('gEstab').classList.remove('dudoso'); actualizarRecordar(); });
  $('gImporte').addEventListener('input', function () { $('gImporte').parentNode.classList.remove('dudoso'); });
  $('gFecha').addEventListener('change', function () { $('gFecha').classList.remove('dudoso'); });
  $('gCategoria').addEventListener('change', function () {
    est.categoriaTocada = true;
    var nueva = $('gCategoria').value === '__nueva';
    $('gCategoriaNueva').classList.toggle('oculto', !nueva);
    if (nueva) $('gCategoriaNueva').focus();
    actualizarRecordar();
  });
  $('gCategoriaNueva').addEventListener('input', actualizarRecordar);
  $('medios').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-medio]');
    if (!b) return;
    var m = b.getAttribute('data-medio');
    pintarMedio(est.borrador.medio === m ? '' : m);
  });
  $('frase').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ACCIONES.interpretar(); }
  });
  $('periodos').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-periodo]');
    if (!b) return;
    est.periodo = b.getAttribute('data-periodo');
    pintarFiltros(); pintarHistorial();
  });
  ['hBuscar', 'hDesde', 'hHasta', 'hCategoria'].forEach(function (id) {
    $(id).addEventListener(id === 'hBuscar' ? 'input' : 'change', pintarHistorial);
  });

  // Tras varios minutos en segundo plano se vuelve a pedir el PIN.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { est.ocultoDesde = Date.now(); return; }
    var limite = (Number(CFG.MINUTOS_BLOQUEO) || 5) * 60000;
    if (est.sesion && est.ocultoDesde && Date.now() - est.ocultoDesde > limite) bloquear(true);
  });

  /* ====================== ARRANQUE ====================== */

  construirTeclado();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });

  // Modo de prueba local (solo con el servicio simulado de pruebas/).
  if (window.MG_PRUEBA) { window.MG_PRUEBA(est, { abrirPin: abrirPin, entrar: entrarALaApp }); return; }

  if (!configurada()) {
    $('inicioMensaje').textContent = 'La aplicación aún no está configurada (falta la dirección del servicio).';
    return;
  }
  est.llave = leerLlave();
  if (est.llave) { est.pinCreado = true; abrirPin(); } else iniciarFlujoGoogle();
})();
