import { logger } from '../utils/logger.js';

export default {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, runtime) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = runtime.commands.get(interaction.commandName);
        if (!command) {
          return interaction.reply({ content: 'Dieser Befehl ist nicht verfügbar.', ephemeral: true });
        }

        return command.execute(interaction, runtime);
      }

      if (interaction.isButton()) {
        const handler = runtime.buttonHandlers.find((entry) => entry.match(interaction.customId));
        if (!handler) {
          return interaction.reply({ content: 'Diese Schaltfläche ist nicht mehr gültig.', ephemeral: true });
        }

        return handler.execute(interaction, runtime);
      }

      if (interaction.isAnySelectMenu ? interaction.isAnySelectMenu() : interaction.isStringSelectMenu()) {
        const handler = runtime.selectHandlers?.find((entry) => entry.match(interaction.customId));
        if (!handler) {
          return interaction.reply({ content: 'Dieses Auswahlmenü ist nicht mehr gültig.', ephemeral: true });
        }

        return handler.execute(interaction, runtime);
      }

      if (interaction.isModalSubmit()) {
        const handler = runtime.modalHandlers.find((entry) => entry.match(interaction.customId));
        if (!handler) {
          return interaction.reply({ content: 'Dieses Formular ist nicht mehr gültig.', ephemeral: true });
        }

        return handler.execute(interaction, runtime);
      }
    } catch (error) {
      logger.error('Interaktion fehlgeschlagen.', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Dabei ist ein Fehler aufgetreten. Bitte versuche es erneut.',
          ephemeral: true
        }).catch(() => null);
      }
    }
  }
};