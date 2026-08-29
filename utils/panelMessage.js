import { logger } from './logger.js';

/**
 * Postet oder aktualisiert eine Bot-Nachricht in einem Kanal.
 * Findet automatisch die letzte eigene Nachricht und editiert sie.
 * Falls das Editieren fehlschlägt (z.B. weil die alte Nachricht mit
 * anderen Flags/Components-Version gesendet wurde -> Discord-Fehler 50035),
 * wird die alte Nachricht gelöscht und eine frische Nachricht gesendet,
 * statt den ganzen Bot-Start abstürzen zu lassen.
 */
export async function sendOrEditPanelMessage(channel, client, payload, { label = 'Panel' } = {}) {
  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const botMessage = messages?.find((msg) => msg.author.id === client.user.id) ?? null;

  if (botMessage) {
    try {
      await botMessage.edit(payload);
      logger.info(`${label} aktualisiert.`);
      return botMessage;
    } catch (error) {
      logger.warn(`${label} konnte nicht bearbeitet werden (${error?.code ?? error?.message ?? error}) - Nachricht wird neu erstellt.`);
      await botMessage.delete().catch(() => null);
    }
  }

  const sent = await channel.send(payload);
  logger.info(`${label} gepostet.`);
  return sent;
}