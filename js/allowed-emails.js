// =============================================================
// Lista de correos autorizados a registrarse y usar la app.
// Edita este array para añadir o quitar amigos.
//
// IMPORTANTE: esta lista por sí sola NO basta. También tienes que
// mantener la misma lista dentro de la función isAllowedUser() en
// firestore.rules (y volver a pegar esas reglas en la consola de
// Firebase) — de lo contrario, aunque alguien pase el filtro de
// aquí, la base de datos seguirá rechazándolo, o al revés. Este
// archivo controla la experiencia en el navegador (qué ve la
// persona); firestore.rules controla el acceso real a los datos.
// =============================================================

export const ALLOWED_EMAILS = [
  "gonzalojh596@gmail.com",
  "djoserralozanopinilla@gmail.com",
  "antoniolopeznoriega01@gmail.com",
];
