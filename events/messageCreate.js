import { logger } from '../utils/logger.js';
import { refreshTeamListPanel } from '../utils/panels.js';
import { handleBewerbungDmMessage } from '../utils/bewerbung.js';

export default {
  name: 'messageCreate',
  once: false,
  async execute(message, runtime) {
    // Konsolen-Log NUR für Bot-Nachrichten – damit wird nicht jede Server-Nachricht
    // ins Log geschrieben, sondern nur die Nachrichten, die der Bot selbst sendet.
    if (message.author.bot) {
      const channelLabel = message.channel?.isDMBased?.()
        ? 'DM'
        : `#${message.channel?.name || message.channelId}`;
      const contentPreview = String(message.content || '').replace(/\s+/g, ' ').trim();
      logger.info(
        `[BOT] ${channelLabel} | ${message.author.tag} (${message.author.id})` +
          (contentPreview ? ` | "${contentPreview.slice(0, 300)}"` : ' | (ohne Text)')
      );
      return;
    }

    // Bewerbungs-Dialog per DM: Antworten auf die gestellten Fragen erfassen.
    if (message.channel?.isDMBased?.()) {
      const handled = await handleBewerbungDmMessage(message, runtime).catch((error) => {
        logger.error('Bewerbungs-DM konnte nicht verarbeitet werden.', error);
        return false;
      });
      if (handled) {
        return;
      }
    }

    if (!runtime.config.nametag.channelId) {
      return;
    }

    if (message.channelId !== runtime.config.nametag.channelId) {
      return;
    }

    const robloxName = message.content.trim();
    if (!robloxName) {
      await message.delete().catch(() => null);
      return;
    }

    runtime.db.upsertRobloxName(runtime.config.guildId, message.author.id, robloxName);

    await message.delete().catch((error) => {
      logger.warn('Roblox-Name-Nachricht konnte nicht gelöscht werden.', error?.message ?? error);
    });

    await refreshTeamListPanel(message.client, runtime).catch((error) => {
      logger.warn('Teamliste konnte nach einer Roblox-Namensänderung nicht aktualisiert werden.', error?.message ?? error);
    });
  }
};