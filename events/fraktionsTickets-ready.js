// Postet oder aktualisiert das Fraktions-Tickets-Panel beim Bot-Start

import { Events } from 'discord.js';
import { buildFraktionsTicketPanelPayload } from '../utils/fraktionsTickets.js';
import { sendOrEditPanelMessage } from '../utils/panelMessage.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, runtime) {
    const panelChannelId = runtime.config.fraktionsTickets?.panelChannelId;

    if (!panelChannelId) {
      logger.warn('Kein fraktionsTickets.panelChannelId in der config.json gesetzt - Fraktions-Tickets-Panel wird nicht gepostet.');
      return;
    }

    try {
      const channel = client.channels.cache.get(panelChannelId)
        ?? await client.channels.fetch(panelChannelId).catch((fetchError) => {
          logger.error(`Fraktions-Tickets-Panel-Kanal ${panelChannelId} konnte nicht geladen werden: ${fetchError?.message ?? fetchError}`);
          return null;
        });

      if (!channel) {
        logger.error(`Fraktions-Tickets-Panel-Kanal ${panelChannelId} nicht gefunden. Prüfe: (1) Ist die ID korrekt? (2) Ist der Bot auf dem Server? (3) Hat der Bot "Kanal ansehen"-Rechte?`);
        return;
      }

      if (!channel.isTextBased()) {
        logger.error('Der Fraktions-Tickets-Panel-Kanal ist kein Textkanal.');
        return;
      }

      await sendOrEditPanelMessage(channel, client, buildFraktionsTicketPanelPayload(), { label: 'Fraktions-Tickets-Panel' });
    } catch (error) {
      logger.error('Fehler beim Verwalten des Fraktions-Tickets-Panels.', error);
    }
  }
};
