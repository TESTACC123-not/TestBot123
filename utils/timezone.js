// Setzt die Standard-Zeitzone des Bots auf deutsche Zeit (Europe/Berlin).
// Muss vor allen anderen Modulen geladen werden, damit Zeitangaben überall
// in deutscher Zeit erscheinen – unabhängig vom Server-Standort.
process.env.TZ = 'Europe/Berlin';

export const TIME_ZONE = 'Europe/Berlin';
