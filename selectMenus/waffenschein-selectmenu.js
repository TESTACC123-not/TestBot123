import { MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  createWaffenscheinTicketChannel,
  getWaffenscheinType
} from '../utils/waffenschein.js';

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function handleTypeSelect(interaction, runtime) {
  const typeKey = interaction.values[0];
  const config = runtime.config.waffenschein || {};

  if (!config.categoryId) {
    return replyEphemeral(interaction, 'Es ist keine Ticket-Kategorie konfiguriert (waffenschein.categoryId).');
  }

  const type = getWaffenscheinType(runtime.config, typeKey);
  if (!type) {
    return replyEphemeral(interaction, 'Diese Waffenschein-Stufe ist nicht konfiguriert.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { channel, created } = await createWaffenscheinTicketChannel(
      interaction.guild,
      interaction.member,
      typeKey,
      runtime.config
    );

    if (!created) {
      return replyEphemeral(interaction, `Du hast bereits ein offenes Waffenschein-Ticket: <#${channel.id}>`);
    }

    return replyEphemeral(interaction, `✅ Dein Waffenschein-Ticket wurde erstellt: <#${channel.id}>`);
  } catch (error) {
    logger.error('Waffenschein-Ticket konnte nicht erstellt werden.', error);
    return replyEphemeral(interaction, '❌ Das Ticket konnte nicht erstellt werden. Bitte versuche es erneut.');
  }
}

const handlers = [
  {
    name: 'waffenschein_select',
    match: (customId) => customId === 'waffenschein_select',
    execute: (interaction, runtime) => handleTypeSelect(interaction, runtime)
  }
];

export default handlers;
