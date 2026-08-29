import { logger } from '../utils/logger.js';
import { registerSlashCommands } from '../utils/loader.js';
import { syncWaitingRooms } from '../utils/waitingRooms.js';
import { expireBewerbungRejectRoles } from '../utils/bewerbung.js';
import {
  expireStaleSupportCases,
  refreshAllPanels,
  startMaintenanceLoop,
  syncAutomaticTrainerAssignments,
  syncExpiredAbsences,
  syncOpenSupportCases,
  syncWaitingRoomSupportCases
} from '../utils/panels.js';

async function runStep(name, fn) {
  try {
    await fn();
  } catch (error) {
    logger.error(`Init-Schritt "${name}" ist fehlgeschlagen - andere Schritte werden trotzdem fortgesetzt.`, error);
  }
}

export default {
  name: 'clientReady',
  once: true,
  async execute(client, runtime) {
    logger.info(`Eingeloggt als ${client.user.tag}`);
    logger.info('Build-Version: 2026-08-05-goodbye-embed-v2 (falls das hier NICHT in deiner Konsole erscheint, läuft noch alter Code!)');

    if (!runtime.config.duty?.areas?.support?.waitingChannelId) {
      logger.warn('Support-Warteraum ist nicht konfiguriert. Bitte duty.areas.support.waitingChannelId in der config.json setzen.');
    }

    await runStep('Slash-Commands registrieren', () => registerSlashCommands(runtime));

    // Jeder Schritt läuft einzeln abgesichert: Ein Fehler in einem Schritt
    // (z.B. Support-Sync) verhindert nicht mehr, dass die restlichen Schritte
    // (inkl. refreshAllPanels -> Verify/On-Duty/Fly/Team-Liste/etc.) laufen.
    await runStep('Abgelaufene Support-Fälle bereinigen', () => expireStaleSupportCases(runtime));
    await runStep('Warteraum-Support-Fälle synchronisieren', () => syncWaitingRoomSupportCases(client, runtime));
    await runStep('Wartebereiche synchronisieren (High Team, Leitung)', () => syncWaitingRooms(client, runtime));
    await runStep('Offene Support-Fälle synchronisieren', () => syncOpenSupportCases(client, runtime));
    await runStep('Abgelaufene Abmeldungen synchronisieren', () => syncExpiredAbsences(client, runtime));
    await runStep('Automatische Trainer-Zuweisungen synchronisieren', () => syncAutomaticTrainerAssignments(client, runtime));
    await runStep('Panels posten/aktualisieren (Verify, On-Duty, Fly, Team-Liste, ...)', () => refreshAllPanels(client, runtime));
    await runStep('Abgelaufene Bewerbungs-Ablehnungsrollen entfernen', () => expireBewerbungRejectRoles(client, runtime));

    try {
      startMaintenanceLoop(client, runtime);
    } catch (error) {
      logger.error('Wartungsroutine konnte nicht gestartet werden.', error);
    }
  }
};