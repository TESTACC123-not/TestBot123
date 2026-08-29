import { logger } from '../utils/logger.js';
import { refreshTeamListPanel } from '../utils/panels.js';

export default {
  name: 'messageCreate',
  once: false,
  async execute(message, runtime) {
    if (message.author.bot) {
      return;
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