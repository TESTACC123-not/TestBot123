// Diese Datei gehört in den events/ Ordner (NICHT als ready.js speichern!)
// Postet oder aktualisiert die fest codierte Immobilienliste beim Bot-Start

import { Events } from 'discord.js';
import { buildRealEstateEmbed, DEFAULT_REAL_ESTATES } from '../utils/realEstate.js';
import { sendOrEditPanelMessage } from '../utils/panelMessage.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, runtime) {
    const channelId = runtime.config.panels?.realEstate?.channelId;

    if (!channelId) {
      logger.warn('Kein panels.realEstate.channelId in der config.json gesetzt - Immobilienliste wird nicht gepostet.');
      return;
    }

    try {
      const channel = client.channels.cache.get(channelId)
        ?? await client.channels.fetch(channelId).catch((fetchError) => {
          logger.error(`Immobilien-Kanal ${channelId} konnte nicht geladen werden: ${fetchError?.message ?? fetchError}`);
          return null;
        });

      if (!channel) {
        logger.error(`Immobilien-Kanal ${channelId} nicht gefunden. Prüfe: (1) Ist die ID korrekt? (2) Ist der Bot auf dem Server? (3) Hat der Bot "Kanal ansehen"-Rechte für diesen Kanal?`);
        return;
      }

      if (!channel.isTextBased()) {
        logger.error('Der Immobilien-Kanal ist kein Textkanal.');
        return;
      }

      // Basis-Daten der Häuser sicherstellen und Live-Status aus der Datenbank laden.
      runtime.db.ensureRealEstateDefaults(
        runtime.config.guildId,
        DEFAULT_REAL_ESTATES.map((house) => ({ id: house.id, label: house.name, priceLabel: house.preis }))
      );
      const rows = runtime.db.listRealEstates(runtime.config.guildId);

      await sendOrEditPanelMessage(channel, client, buildRealEstateEmbed(rows), { label: 'Immobilienliste' });
    } catch (error) {
      logger.error('Fehler beim Verwalten der Immobilienliste.', error);
    }
  }
};