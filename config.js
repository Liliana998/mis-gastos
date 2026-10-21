// Mis Gastos - configuracion publica de la aplicacion.
// Estos datos NO son secretos: sin la identidad de Google de la propietaria,
// la llave del dispositivo y el PIN, el servicio no entrega ningun dato.
window.CONFIG_MG = {
  // Direccion de la implementacion de Api.gs de Mis Gastos (termina en /exec).
  // Se completa cuando la propietaria publique el servicio.
  API_URL: 'https://script.google.com/macros/s/AKfycbxWnlU5Rr_cy2x7d7Px429Cn63hlQfnv8Aj7pEaMK56DVcz4KhkKISr4IJM5NmKarU/exec',
  // Mismo ID de cliente que Archivo de Comprobantes (mismo origen autorizado).
  ID_CLIENTE: '575889810613-87gle57sd5l8rp6je69cc66slnkp5ch6.apps.googleusercontent.com',
  // Minutos en segundo plano tras los cuales se vuelve a pedir el PIN.
  MINUTOS_BLOQUEO: 5
};
