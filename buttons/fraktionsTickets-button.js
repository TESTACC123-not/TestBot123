import { MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  buildFraktionsTicketPayload,
  createFraktionsTicketChannel,
  getFraktionsTicketTitle,
  parseFraktionsTicketTopic
} from '../utils/fraktionsTickets.js';

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function handleOpen(interaction, runtime) {
  const config = runtime.config.fraktionsTickets || {};

  if (!config.panelChannelId) {
    return replyEphemeral(interaction, 'Das Fraktions-Tickets-System ist nicht konfiguriert (fraktionsTickets.panelChannelId).');
  }
  if (!config.categoryId) {
    return replyEphemeral(interaction, 'Es ist keine Ticket-Kategorie konfiguriert (fraktionsTickets.categoryId).');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { channel, created } = await createFraktionsTicketChannel(
      interaction.guild,
      interaction.member,
      runtime.config
    );

    if (!created) {
      return replyEphemeral(interaction, `Du hast bereits ein offenes Fraktions-Ticket: <#${channel.id}>`);
    }

    return replyEphemeral(interaction, `✅ Dein Fraktions-Ticket wurde erstellt: <#${channel.id}>`);
  } catch (error) {
    logger.error('Fraktions-Ticket konnte nicht erstellt werden.', error);
    return replyEphemeral(interaction, '❌ Das Ticket konnte nicht erstellt werden. Bitte versuche es erneut.');
  }
}

async function handleClose(interaction, runtime) {
  const parsed = parseFraktionsTicketTopic(interaction.channel?.topic);
  if (!parsed) {
    return replyEphemeral(interaction, 'Dieser Kanal ist kein gültiges Fraktions-Ticket.');
  }

  const title = getFraktionsTicketTitle(runtime.config);

  // Nachricht aktualisieren und Ticket entfernen
  const messages = await interaction.channel.messages.fetch({ limit: 10 }).catch(() => null);
  const botMessage = messages?.find((msg) => msg.author.id === interaction.client.user.id) ?? null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (botMessage) {
    await botMessage.edit(buildFraktionsTicketPayload({ ownerId: parsed.ownerId, title, status: 'closed' }))
      .catch((error) => logger.warn('Fraktions-Ticket konnte nicht geschlossen werden.', error?.message ?? error));
  }

  await replyEphemeral(interaction, '🔒 Das Ticket wurde geschlossen.');

  // Kanal nach kurzer Verzögerung löschen
  setTimeout(async () => {
    await interaction.channel.delete().catch((error) => {
      logger.warn('Fraktions-Ticket-Kanal konnte nicht gelöscht werden.', error?.message ?? error);
    });
  }, 3000);

  return null;
}

const handlers = [
  {
    name: 'fraktions_ticket_open',
    match: (customId) => customId === 'fraktions_ticket_open',
    execute: (interaction, runtime) => handleOpen(interaction, runtime)
  },
  {
    name: 'fraktions_ticket_close',
    match: (customId) => customId.startsWith('fraktions_ticket_close:'),
    execute: (interaction, runtime) => handleClose(interaction, runtime)
  }
];

export default handlers;
