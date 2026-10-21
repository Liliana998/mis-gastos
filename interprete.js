/**
 * Mis Gastos - interprete.js v1
 * Convierte en un gasto propuesto:
 *   - una frase escrita o dictada ("Gasté 100 pesos en Dairy Queen hoy"),
 *   - el texto OCR de un ticket.
 * Reglas propias, sin servicios externos ni inteligencia artificial de pago.
 * Siempre propone; la propietaria revisa y corrige antes de guardar.
 */
(function (raiz) {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MESES_CORTOS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8,
    sep: 9, set: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12 };
  var DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  /* ---------------- utilidades ---------------- */

  function sinAcentos(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function norm(s) {
    return sinAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function clave(s) {
    return sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); }
  function fechaValida(a, m, d) {
    var f = new Date(a, m - 1, d);
    return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d ? f : null;
  }
  function soloDia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function anioCompleto(a) { a = Number(a); return a < 100 ? 2000 + a : a; }
  function titulo(s) {
    return s.replace(/\s+/g, ' ').trim().replace(/(^|[\s'-])([a-záéíóúñü])/g, function (m, p, l) {
      return p + l.toUpperCase();
    });
  }

  /* ---------------- importes ---------------- */

  // "1,234.50" "1 234.50" "$99" "99,50" -> numero
  function aNumero(t) {
    t = String(t).replace(/[$\s]/g, '');
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return Number(t.replace(/,/g, ''));
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
    if (/^\d+,\d{1,2}$/.test(t)) return Number(t.replace(',', '.'));
    if (/^\d+(\.\d{1,2})?$/.test(t)) return Number(t);
    return NaN;
  }

  var UNIDADES = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
    catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
    veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
    veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
    ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200,
    trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
    quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
    setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
    novecientos: 900, novecientas: 900 };

  // Convierte numeros escritos con palabras ("mil quinientos") a digitos.
  function palabrasANumeros(texto) {
    var palabras = texto.split(' ');
    var salida = [];
    var i = 0;
    while (i < palabras.length) {
      var j = i, total = 0, actual = 0, usadas = 0;
      while (j < palabras.length) {
        var w = palabras[j];
        if (UNIDADES.hasOwnProperty(w)) { actual += UNIDADES[w]; usadas++; }
        else if (w === 'mil') { total += (actual || 1) * 1000; actual = 0; usadas++; }
        else if (w === 'millon' || w === 'millones') { total += (actual || 1) * 1000000; actual = 0; usadas++; }
        else if (w === 'y' && usadas && j + 1 < palabras.length &&
                 UNIDADES.hasOwnProperty(palabras[j + 1]) && UNIDADES[palabras[j + 1]] < 10) { /* treinta y dos */ }
        else break;
        j++;
      }
      // "un" o "una" sueltos no son importes ("en un restaurante")
      if (usadas && !(usadas === 1 && /^(un|una|uno)$/.test(palabras[i]))) {
        salida.push(String(total + actual));
        i = j;
      } else {
        salida.push(palabras[i]);
        i++;
      }
    }
    return salida.join(' ');
  }

  /* ---------------- medio de pago ---------------- */

  var RX_EFECTIVO = /\b(en efectivo|efectivo|cash|al contado)\b/;
  var RX_TARJETA = /\b(con tarjeta( de (credito|debito))?|tarjeta( de (credito|debito))?|con (la )?(visa|mastercard|amex)|visa|mastercard|master card|american express|amex|debito|credito|tdc|tdd)\b/;
  var RX_TRANSF = /\b(por transferencia|con transferencia|transferencia|transferi|spei)\b/;

  /* ---------------- fechas ---------------- */

  function fechaDeFrase(t, hoy) {
    var h = soloDia(hoy);
    var m;
    if (/\b(antier|anteayer|antes de ayer)\b/.test(t)) {
      return { fecha: new Date(h.getTime() - 2 * 864e5), rx: /\b(antier|anteayer|antes de ayer)\b/ };
    }
    if (/\bayer\b/.test(t)) return { fecha: new Date(h.getTime() - 864e5), rx: /\bayer\b/ };
    if (/\bhoy\b/.test(t)) return { fecha: h, rx: /\bhoy\b/ };
    // "el 17 de octubre de 2026" / "17 de octubre" / "el dia 17 de octubre del 2026"
    var rxLarga = new RegExp('\\b(?:el\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(' + MESES.join('|') +
        ')(?:\\s+(?:de|del)\\s+(\\d{4}))?\\b');
    m = t.match(rxLarga);
    if (m) {
      var mes = MESES.indexOf(m[2]) + 1;
      var anio = m[3] ? Number(m[3]) : h.getFullYear();
      var f = fechaValida(anio, mes, Number(m[1]));
      if (f && !m[3] && f > h) f = fechaValida(anio - 1, mes, Number(m[1]));
      if (f) return { fecha: f, rx: rxLarga };
    }
    // "17/10/2026" "17-10-26" "17/10"
    var rxNum = /\b(?:el\s+)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/;
    m = t.match(rxNum);
    if (m) {
      var an = m[3] ? anioCompleto(m[3]) : h.getFullYear();
      var fn = fechaValida(an, Number(m[2]), Number(m[1]));
      if (fn && !m[3] && fn > h) fn = fechaValida(an - 1, Number(m[2]), Number(m[1]));
      if (fn) return { fecha: fn, rx: rxNum };
    }
    // "el lunes" / "el sabado pasado" -> el mas reciente (sin contar hoy)
    var rxDia = new RegExp('\\b(?:el\\s+)?(' + DIAS_SEMANA.join('|') + ')(?:\\s+pasado)?\\b');
    m = t.match(rxDia);
    if (m) {
      var objetivo = DIAS_SEMANA.indexOf(m[1]);
      var dif = (h.getDay() - objetivo + 7) % 7 || 7;
      return { fecha: new Date(h.getTime() - dif * 864e5), rx: rxDia };
    }
    // "el dia 17" -> este mes (o el anterior si aun no llega)
    var rxDiaMes = /\bel\s+(?:dia\s+)?(\d{1,2})\b(?!\s*(?:pesos|mxn|\$))/;
    m = t.match(rxDiaMes);
    if (m) {
      var fd = fechaValida(h.getFullYear(), h.getMonth() + 1, Number(m[1]));
      if (fd && fd > h) fd = fechaValida(h.getFullYear(), h.getMonth(), Number(m[1]));
      if (fd) return { fecha: fd, rx: rxDiaMes };
    }
    return null;
  }

  /* ---------------- catalogo ---------------- */

  // Busca en el catalogo de establecimientos conocidos (exacto o contenido).
  function buscarEnCatalogo(nombre, catalogo) {
    var k = clave(nombre);
    if (!k || !catalogo || !catalogo.length) return null;
    var exacto = null, parcial = null;
    catalogo.forEach(function (e) {
      var ke = clave(e.nombre);
      if (!ke) return;
      if (ke === k) exacto = e;
      else if (!parcial && ke.length >= 4 && k.length >= 4 &&
               (k.indexOf(ke) !== -1 || ke.indexOf(k) !== -1)) parcial = e;
    });
    return exacto || parcial;
  }

  /* ---------------- frase (voz o texto) ---------------- */

  function interpretarFrase(frase, opciones) {
    opciones = opciones || {};
    var hoy = opciones.hoy || new Date();
    var r = { fecha: iso(hoy), establecimiento: '', importe: null, medio: '', faltan: [] };
    var t = ' ' + norm(frase).replace(/[¿?¡!;]/g, ' ').replace(/\s+/g, ' ') + ' ';
    t = palabrasANumeros(t.trim());
    t = ' ' + t + ' ';

    // Medio de pago
    if (RX_TRANSF.test(t)) { r.medio = 'transferencia'; t = t.replace(RX_TRANSF, ' '); }
    else if (RX_TARJETA.test(t)) { r.medio = 'tarjeta'; t = t.replace(RX_TARJETA, ' '); }
    else if (RX_EFECTIVO.test(t)) { r.medio = 'efectivo'; t = t.replace(RX_EFECTIVO, ' '); }
    t = t.replace(/\b(pague|pago|pagamos)\s+con\s*$/, ' ');

    // Fecha
    var f = fechaDeFrase(t, hoy);
    if (f) { r.fecha = iso(f.fecha); t = t.replace(f.rx, ' '); }

    // Importe: "$1,000" "1000 pesos" "100.50" "100 pesos con 50 centavos"
    var rxImporte = /\$\s*(\d[\d,.\s]*\d|\d)|(\d[\d,.]*\d|\d)\s*(?:pesos|peso|mxn|varos|baros)?(?:\s+con\s+(\d{1,2})\s+centavos)?/;
    var mi = t.match(/\$\s*(\d[\d,.]*\d|\d)(?:\s+con\s+(\d{1,2})\s+centavos)?/) ||
             t.match(/(\d[\d,.]*\d|\d)\s*(?:pesos|peso|mxn)(?:\s+con\s+(\d{1,2})\s+centavos)?/) ||
             t.match(/(\d[\d,.]*\d|\d)(?:\s+con\s+(\d{1,2})\s+centavos)?/);
    if (mi) {
      var n = aNumero(mi[1]);
      if (!isNaN(n)) {
        if (mi[2]) n += Number(mi[2]) / 100;
        r.importe = Math.round(n * 100) / 100;
        t = t.replace(mi[0], ' ');
      }
    }
    void rxImporte;

    // Establecimiento o concepto: lo que queda, sin verbos ni palabras de enlace.
    t = t.replace(/\b(gaste|gastamos|gasto|pague|pagamos|pago|compre|compramos|fueron|fue|me cobraron|cobraron|registra|registrar|anota|anotar|un gasto|gasto de)\b/g, ' ');
    t = t.replace(/\b(pesos|peso|mxn|centavos)\b/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    // Quitar preposiciones y articulos al inicio y al final.
    var conector = /^(en|de|del|por|para|a|al|el|la|los|las|un|una|y|con)\s+/;
    var final = /\s+(en|de|del|por|para|a|al|el|la|los|las|un|una|y|con)$/;
    var prev;
    do { prev = t; t = t.replace(conector, '').replace(final, ''); } while (t !== prev);
    t = t.replace(/^(en|de|del|por|para|a|al|el|la|los|las|y|con)$/, '').trim();

    if (t) {
      var original = recuperarMayusculas(frase, t);
      var conocido = buscarEnCatalogo(t, opciones.catalogo);
      r.establecimiento = conocido && clave(conocido.nombre) === clave(t) ? conocido.nombre : titulo(original);
    }
    if (!r.importe) r.faltan.push('importe');
    if (!r.establecimiento) r.faltan.push('establecimiento');
    return r;
  }

  // Recupera la forma escrita original ("Dairy Queen") a partir de la normalizada.
  function recuperarMayusculas(frase, normalizado) {
    var palabras = String(frase).split(/\s+/);
    var objetivo = normalizado.split(' ');
    for (var i = 0; i + objetivo.length <= palabras.length; i++) {
      var ok = true;
      for (var j = 0; j < objetivo.length; j++) {
        if (norm(palabras[i + j]).replace(/[.,;:!?¡¿]/g, '') !== objetivo[j]) { ok = false; break; }
      }
      if (ok) {
        return palabras.slice(i, i + objetivo.length).join(' ').replace(/[.,;:!?]+$/, '');
      }
    }
    return normalizado;
  }

  /* ---------------- ticket (texto OCR) ---------------- */

  // Cadenas frecuentes en Cancun. El catalogo propio de la propietaria tiene prioridad.
  var CADENAS = [
    ['Walmart', /wal\s*-?\s*mart|walmart/], ['Bodega Aurrera', /bodega\s+aurrera|aurrera/],
    ['Sam\'s Club', /sam'?s\s+club/], ['Soriana', /soriana/], ['Chedraui', /chedraui/],
    ['La Comer', /la\s+comer\b|fresko|city\s+market/], ['Costco', /costco/],
    ['Oxxo', /oxxo/], ['KFC', /\bkfc|kentucky/],
    ['CFE', /comision federal de electricidad|\bcfe\b|cfe\s*-?\s*contigo|numero de medidor|\bhilos\b/], ['7-Eleven', /7\s*-?\s*eleven/], ['Circle K', /circle\s*k/],
    ['Farmacias Guadalajara', /farmacias?\s+guadalajara/], ['Farmacias del Ahorro', /del\s+ahorro/],
    ['Farmacias Similares', /similares/], ['Farmacias Benavides', /benavides/],
    ['Farmacia San Pablo', /san\s+pablo/], ['Farmacias Yza', /\byza\b/],
    ['Home Depot', /home\s+depot/], ['Liverpool', /liverpool/], ['Coppel', /coppel/],
    ['Starbucks', /starbucks/], ['Dairy Queen', /dairy\s+queen/], ['McDonald\'s', /mc\s*donald/],
    ['Burger King', /burger\s+king/], ['Domino\'s', /domino'?s/], ['Little Caesars', /little\s+caesar/],
    ['Gomar', /\bgomar\b/], ['Office Depot', /office\s+depot/], ['Sanborns', /sanborns/],
    ['Pemex', /pemex/], ['Petro 7', /petro\s*-?\s*7/], ['Mega Soriana', /mega\s+soriana/]
  ];

  var RX_RUIDO = /\b(r\.?f\.?c|rfc|c\.?p\.?|tel|telefono|col\.?|av\.?|avenida|calle|mz|lt|sm|s\.?a\.? de c\.?v|regimen|fiscal|sucursal|tienda|ticket|folio|caja|cajero|fecha|hora|bienvenid|gracias|www|http|factura|cliente|vendedor|mesa|mesero|cuenta|orden)\b/;
  var RX_IMPORTE_LINEA = /\$?\s*-?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})\b|\$?\s*-?\d+[.,]\d{2}\b/g;

  function importesDe(linea) {
    var out = [];
    var m;
    RX_IMPORTE_LINEA.lastIndex = 0;
    while ((m = RX_IMPORTE_LINEA.exec(linea))) {
      if (/-/.test(m[0])) continue;
      var n = aNumero(m[0]);
      if (!isNaN(n) && n > 0) out.push(n);
    }
    return out;
  }

  function fechaDeTicket(lineas, hoy) {
    var h = soloDia(hoy);
    var limite = new Date(h.getFullYear() - 2, h.getMonth(), h.getDate());
    var candidatas = [];
    var mesesRx = '(' + Object.keys(MESES_CORTOS).join('|') + ')[a-z]*';
    lineas.forEach(function (l) {
      var t = norm(l).replace(/[oO](?=\d)|(?<=\d)[oO]/g, '0');
      var m, rx;
      rx = /\b(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})\b/g;
      while ((m = rx.exec(t))) {
        candidatas.push(fechaValida(anioCompleto(m[3]), Number(m[2]), Number(m[1])));
      }
      rx = /\b(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\b/g;
      while ((m = rx.exec(t))) {
        candidatas.push(fechaValida(Number(m[1]), Number(m[2]), Number(m[3])));
      }
      rx = new RegExp('\\b(\\d{1,2})\\s*[\\/.\\- ]\\s*' + mesesRx + '\\.?\\s*[\\/.\\- ]\\s*(\\d{2,4})\\b', 'g');
      while ((m = rx.exec(t))) {
        candidatas.push(fechaValida(anioCompleto(m[3]), MESES_CORTOS[m[2].slice(0, 3)] ||
            MESES.indexOf(m[2]) + 1, Number(m[1])));
      }
      rx = new RegExp('\\b' + mesesRx + '\\.?\\s*(\\d{1,2})\\s*[\'`´]\\s*(\\d{2})\\b', 'g');
      while ((m = rx.exec(t))) {
        candidatas.push(fechaValida(anioCompleto(m[3]), MESES_CORTOS[m[1].slice(0, 3)], Number(m[2])));
      }
      rx = new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + MESES.join('|') + ')\\s+(?:de|del)\\s+(\\d{4})\\b', 'g');
      while ((m = rx.exec(t))) {
        candidatas.push(fechaValida(Number(m[3]), MESES.indexOf(m[2]) + 1, Number(m[1])));
      }
    });
    for (var i = 0; i < candidatas.length; i++) {
      var c = candidatas[i];
      if (c && c <= h && c >= limite) return iso(c);
    }
    return '';
  }

  // Palabras numericas con tolerancia a errores del OCR ("IREINTA" -> treinta).
  function distancia(a, b) {
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }
  var PALABRAS_NUM = Object.keys(UNIDADES).concat(['mil', 'millon', 'millones']);
  function palabraNumerica(w) {
    if (PALABRAS_NUM.indexOf(w) !== -1) return w;
    if (w.length < 4) return null;
    var tope = w.length >= 8 ? 2 : 1, mejor = null, md = 99;
    PALABRAS_NUM.forEach(function (p) {
      var dd = distancia(w, p);
      if (dd < md) { md = dd; mejor = p; }
    });
    return md <= tope ? mejor : null;
  }

  // Importe con letra: "DOSCIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N."
  function importeConLetra(lineas) {
    for (var i = 0; i < lineas.length; i++) {
      var l = norm(lineas[i]).replace(/[^a-z0-9\/ ]/g, ' ').replace(/\s+/g, ' ');
      var m = l.match(/^(.*?)\bpesos?\b(?:\s+(\d{2})\s*\/\s*1[0o]{2})?/);
      if (!m || !m[1].trim()) continue;
      var palabras = m[1].trim().split(' ');
      var buenas = [];
      for (var k = palabras.length - 1; k >= 0; k--) {
        var w = palabras[k];
        if (w === 'y' && buenas.length) { buenas.unshift('y'); continue; }
        var p = palabraNumerica(w);
        if (!p) break;
        buenas.unshift(p);
      }
      while (buenas[0] === 'y') buenas.shift();
      if (!buenas.length) continue;
      var n = Number(palabrasANumeros(buenas.join(' ')));
      if (n > 0 && /^\d+$/.test(palabrasANumeros(buenas.join(' ')))) {
        return { importe: n + (m[2] ? Number(m[2]) / 100 : 0), completo: k < 0 || palabras.length === buenas.length };
      }
    }
    return null;
  }

  function totalDeTicket(lineas) {
    var numerico = totalNumerico(lineas);
    var letra = importeConLetra(lineas);
    if (!letra) return numerico;
    var todos = [];
    lineas.forEach(function (l) { todos = todos.concat(importesDe(norm(l))); });
    var coincide = function (x) { return Math.abs(x - letra.importe) < 0.01 || Math.abs(Math.floor(x) - Math.floor(letra.importe)) < 0.5 && !(letra.importe % 1); };
    if (numerico && coincide(numerico.importe)) return { importe: numerico.importe, seguro: true };
    var igual = todos.filter(coincide);
    if (igual.length) return { importe: Math.max.apply(null, igual), seguro: true };
    // Letra incompleta por el OCR ("...ciento cincuenta y siete" de 10,157.00)
    var parcial = todos.filter(function (x) { return Math.floor(x) % 1000 === Math.floor(letra.importe) % 1000 && x > letra.importe; });
    if (!numerico && parcial.length) return { importe: Math.max.apply(null, parcial), seguro: false };
    if (numerico) return { importe: numerico.importe, seguro: false };
    return { importe: letra.importe, seguro: false };
  }

  function totalNumerico(lineas) {
    // Tolerancia a la lectura del OCR: "lotal", "FOTAL", "TOTAI".
    var L = lineas.map(function (l) { return norm(l).replace(/\b[tfli1i]o[tf][ai][li1]\b/g, 'total'); });
    var siguiente = function (i) {
      for (var k = i + 1; k < Math.min(L.length, i + 3); k++) {
        var v = importesDe(L[k]);
        if (v.length) return v[v.length - 1];
      }
      return null;
    };
    // Encabezados de columna ("CANT ARTICULO PRECIO TOTAL") y totales parciales no cuentan.
    var excluir = /(\b(articulo|cant|cantidad|precio|descripcion|producto|promocion|u\.?\s*m)\b|sub\s*-?\s*total|subtot|total\s+(de\s+)?(art|arti|prod|piezas|pzas|unid|items|ahorr|desc|iva|ieps|impuesto)|ahorro|descuento|propina\s+sugerida|articulos)/;
    var prioridades = [
      /total\s+a\s+pagar|importe\s+total|total\s+m\.?\s*n|total\s+mxn|total\s+neto|gran\s+total|total\s+general|monto\s+total|total\s+venta/,
      /\btotal\b/,
      /\bimporte\b|\ba\s+pagar\b|\bpagar\b|\bmonto\b/
    ];
    for (var p = 0; p < prioridades.length; p++) {
      var encontrados = [];
      for (var i = 0; i < L.length; i++) {
        if (!prioridades[p].test(L[i]) || excluir.test(L[i])) continue;
        var v = importesDe(L[i]);
        var n = v.length ? v[v.length - 1] : siguiente(i);
        if (n) encontrados.push(n);
      }
      // En tickets el total suele repetirse; se toma el mayor de los encontrados
      // para no confundirlo con lineas parciales.
      if (encontrados.length) return { importe: Math.max.apply(null, encontrados), seguro: p < 2 };
    }
    // Efectivo - cambio
    var efectivo = null, cambio = null;
    L.forEach(function (l, i) {
      var v = importesDe(l);
      var n = v.length ? v[v.length - 1] : siguiente(i);
      if (/\bcambio\b|\bsu cambio\b/.test(l) && n) cambio = n;
      else if (/\befectivo\b|\brecibido\b|\bsu pago\b|\bpago\b/.test(l) && n) efectivo = n;
    });
    if (efectivo && cambio !== null && efectivo > cambio) {
      return { importe: Math.round((efectivo - cambio) * 100) / 100, seguro: false };
    }
    // Sin "total" ni importe con letra: se deja vacio para que la propietaria
    // lo escriba. Es preferible a proponer un importe equivocado.
    return null;
  }

  function comercioDeTicket(lineas, catalogo) {
    var textoTodo = norm(lineas.join(' '));
    // 1) Establecimientos propios ya registrados.
    if (catalogo && catalogo.length) {
      var kTodo = clave(textoTodo);
      var mejor = null;
      catalogo.forEach(function (e) {
        var k = clave(e.nombre);
        if (k.length >= 4 && kTodo.indexOf(k) !== -1 && (!mejor || k.length > clave(mejor.nombre).length)) mejor = e;
      });
      if (mejor) return { nombre: mejor.nombre, seguro: true };
    }
    // 2) Cadenas conocidas (la mas especifica primero).
    // La cadena cuyo nombre aparece primero en el ticket (encabezado) gana;
    // asi una marca de producto ("Aurrera") no sustituye a la tienda. En empate,
    // la mas especifica ("Mega Soriana" frente a "Soriana").
    var cand = CADENAS.map(function (c) {
      var m = textoTodo.match(c[1]);
      return m ? [c[0], m.index] : null;
    }).filter(Boolean);
    if (cand.length) {
      cand.sort(function (a, b) { return a[1] - b[1] || b[0].length - a[0].length; });
      return { nombre: cand[0][0], seguro: true };
    }
    if (/litroscompletos|\b(magna|premium|premiun|diesel|gasolina)\b[\s\S]{0,80}\b(ltr?s?|litros)\b/.test(textoTodo)) {
      return { nombre: 'Gasolina', seguro: true };
    }
    // 3) Primera linea con aspecto de nombre comercial.
    for (var i = 0; i < Math.min(lineas.length, 8); i++) {
      var l = lineas[i].trim();
      var n = norm(l);
      var letras = (n.match(/[a-z]/g) || []).length;
      if (letras < 3 || letras < n.replace(/\s/g, '').length * 0.6) continue;
      var sinRazon = n.replace(/,?\s*s\.?\s*a\.?\s*(p\.?\s*i\.?\s*)?de\s*c\.?\s*v\.?.*$|,?\s*s\.?\s*de\s*r\.?\s*l\.?.*$/, '').trim();
      if (sinRazon !== n && sinRazon.length >= 3) {
        return { nombre: titulo(sinRazon), seguro: false };
      }
      if (RX_RUIDO.test(n)) continue;
      return { nombre: titulo(l.toLowerCase().replace(/[^a-záéíóúñü0-9&'.\s-]/gi, ' ').replace(/\s+/g, ' ').trim()), seguro: false };
    }
    return { nombre: '', seguro: false };
  }

  function medioDeTicket(texto) {
    var t = norm(texto);
    var tarjeta = /(visa|mastercard|master card|american express|amex|tarjeta|t\.?\s*credito|t\.?\s*debito|\bdebito\b|\bcredito\b|tdc|tdd|aprobad|autorizacion|\bauth\b|\*{3,}\s*\d{4}|x{4,}\s*\d{4}|contactless|chip)/;
    var efectivo = /(efectivo|\bcambio\b|su cambio)/;
    var transf = /(transferencia|\bspei\b)/;
    if (transf.test(t)) return 'transferencia';
    if (tarjeta.test(t)) return 'tarjeta';
    if (efectivo.test(t)) return 'efectivo';
    return '';
  }

  function interpretarTicket(texto, opciones) {
    opciones = opciones || {};
    var hoy = opciones.hoy || new Date();
    var lineas = String(texto || '').split(/\r?\n/).map(function (l) { return l.trim(); })
        .filter(function (l) { return l; });
    var total = totalDeTicket(lineas);
    var comercio = comercioDeTicket(lineas, opciones.catalogo);
    var r = {
      establecimiento: comercio.nombre,
      fecha: fechaDeTicket(lineas, hoy),
      importe: total ? Math.round(total.importe * 100) / 100 : null,
      medio: medioDeTicket(texto),
      dudas: [],
      faltan: []
    };
    if (total && !total.seguro) r.dudas.push('importe');
    if (comercio.nombre && !comercio.seguro) r.dudas.push('establecimiento');
    if (!r.fecha) { r.faltan.push('fecha'); r.fecha = iso(hoy); r.dudas.push('fecha'); }
    if (!r.importe) r.faltan.push('importe');
    if (!r.establecimiento) r.faltan.push('establecimiento');
    return r;
  }

  /* ---------------- duplicados ---------------- */

  // Posibles repetidos: mismo importe y misma fecha, o mismo importe y mismo
  // establecimiento con un dia de diferencia. Nunca se rechaza nada.
  function posiblesDuplicados(g, gastos) {
    var k = clave(g.establecimiento);
    var dia = new Date(g.fecha + 'T12:00:00').getTime();
    return (gastos || []).filter(function (x) {
      if (g.id && x.id === g.id) return false;
      if (Math.abs(Number(x.importe) - Number(g.importe)) > 0.009) return false;
      var dif = Math.abs(new Date(x.fecha + 'T12:00:00').getTime() - dia) / 864e5;
      if (dif < 0.5) return true;
      var kx = clave(x.establecimiento);
      return dif <= 1.5 && k && kx && (k === kx || k.indexOf(kx) !== -1 || kx.indexOf(k) !== -1);
    });
  }

  var api = {
    interpretarFrase: interpretarFrase,
    interpretarTicket: interpretarTicket,
    buscarEnCatalogo: buscarEnCatalogo,
    posiblesDuplicados: posiblesDuplicados,
    clave: clave,
    norm: norm,
    iso: iso,
    aNumero: aNumero
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Interprete = api;
})(this);
