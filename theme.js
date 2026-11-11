// Aplica el tema guardado antes de pintar, para que no parpadee.
try {
  var t = localStorage.getItem('bazar-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
