// Diese Datei gehört in den events/ Ordner
// Postet oder aktualisiert das Hauskauf-Ticket-Panel beim Bot-Start

import { Events } from 'discord.js';
import { buildTicketHausKaufPanelPayload } from '../utils/ticketHausKauf.js';
import { sendOrEditPanelMessage } from '../utils/panelMessage.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, runtime) {
    const panelChannelId = runtime.config.hausTicket?.panelChannelId;

    if (!panelChannelId) {
      logger.warn('Kein hausTicket.panelChannelId in der config.json gesetzt - Ticket-Panel wird nicht gepostet.');
      return;
    }

    try {
      const channel = client.channels.cache.get(panelChannelId)
        ?? await client.channels.fetch(panelChannelId).catch((fetchError) => {
          logger.error(`Ticket-Panel-Kanal ${panelChannelId} konnte nicht geladen werden: ${fetchError?.message ?? fetchError}`);
          return null;
        });

      if (!channel) {
        logger.error(`Ticket-Panel-Kanal ${panelChannelId} nicht gefunden. Prüfe: (1) Ist die ID korrekt? (2) Ist der Bot auf dem Server? (3) Hat der Bot "Kanal ansehen"-Rechte für diesen Kanal?`);
        return;
      }

      if (!channel.isTextBased()) {
        logger.error('Der Ticket-Panel-Kanal ist kein Textkanal.');
        return;
      }

      await sendOrEditPanelMessage(channel, client, buildTicketHausKaufPanelPayload(), { label: 'Hauskauf-Ticket-Panel' });
    } catch (error) {
      logger.error('Fehler beim Verwalten des Hauskauf-Ticket-Panels.', error);
    }
  }
};