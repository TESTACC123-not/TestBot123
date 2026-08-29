// Postet oder aktualisiert das Waffenschein-Panel beim Bot-Start

import { Events } from 'discord.js';
import { buildWaffenscheinPanelPayload } from '../utils/waffenschein.js';
import { sendOrEditPanelMessage } from '../utils/panelMessage.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, runtime) {
    const panelChannelId = runtime.config.waffenschein?.panelChannelId;

    if (!panelChannelId) {
      logger.warn('Kein waffenschein.panelChannelId in der config.json gesetzt - Waffenschein-Panel wird nicht gepostet.');
      return;
    }

    try {
      const channel = client.channels.cache.get(panelChannelId)
        ?? await client.channels.fetch(panelChannelId).catch((fetchError) => {
          logger.error(`Waffenschein-Panel-Kanal ${panelChannelId} konnte nicht geladen werden: ${fetchError?.message ?? fetchError}`);
          return null;
        });

      if (!channel) {
        logger.error(`Waffenschein-Panel-Kanal ${panelChannelId} nicht gefunden. Prüfe: (1) Ist die ID korrekt? (2) Ist der Bot auf dem Server? (3) Hat der Bot "Kanal ansehen"-Rechte?`);
        return;
      }

      if (!channel.isTextBased()) {
        logger.error('Der Waffenschein-Panel-Kanal ist kein Textkanal.');
        return;
      }

      await sendOrEditPanelMessage(channel, client, buildWaffenscheinPanelPayload(), { label: 'Waffenschein-Panel' });
    } catch (error) {
      logger.error('Fehler beim Verwalten des Waffenschein-Panels.', error);
    }
  }
};
