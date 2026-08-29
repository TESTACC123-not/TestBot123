import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  buildAddPersonSelectPayload,
  buildFraktionsTicketPayload,
  buildRemovePersonSelectPayload,
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

function isStaffOrAdmin(member, pingRoleId) {
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  return pingRoleId ? member.roles.cache.has(pingRoleId) : false;
}

function canCloseTicket(member, ownerId, pingRoleId) {
  return member.id === ownerId || isStaffOrAdmin(member, pingRoleId);
}

function isValidTicketChannel(channel) {
  return Boolean(parseFraktionsTicketTopic(channel?.topic));
}

async function handleTicketOpen(interaction, runtime) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { channel, created } = await createFraktionsTicketChannel(interaction.guild, interaction.member, runtime.config);

    return interaction.editReply({
      content: created
        ? `✅ Dein Ticket wurde erstellt: ${channel}`
        : `ℹ️ Du hast bereits ein offenes Ticket: ${channel}`
    });
  } catch (error) {
    logger.error('Fraktions-Ticket konnte nicht erstellt werden.', error);
    return replyEphemeral(interaction, '❌ Beim Erstellen des Tickets ist ein Fehler aufgetreten.');
  }
}

async function handleTicketClaim(interaction, runtime) {
  if (!isValidTicketChannel(interaction.channel)) {
    return replyEphemeral(interaction, '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.');
  }

  if (!isStaffOrAdmin(interaction.member, runtime.config.fraktionsTickets.pingRoleId)) {
    return replyEphemeral(interaction, '❌ Du bist nicht berechtigt, Tickets zu übernehmen.');
  }

  const ownerId = parseFraktionsTicketTopic(interaction.channel.topic).ownerId;
  const title = getFraktionsTicketTitle(runtime.config);
  const payload = buildFraktionsTicketPayload({ ownerId, title, claimedBy: interaction.member });

  await interaction.update(payload);
  await interaction.channel.send({ content: `🎫 <@${interaction.user.id}> hat das Ticket übernommen.` });
}

async function handleTicketRelease(interaction, runtime) {
  if (!isValidTicketChannel(interaction.channel)) {
    return replyEphemeral(interaction, '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.');
  }

  if (!isStaffOrAdmin(interaction.member, runtime.config.fraktionsTickets.pingRoleId)) {
    return replyEphemeral(interaction, '❌ Du bist nicht berechtigt, Tickets freizugeben.');
  }

  const ownerId = parseFraktionsTicketTopic(interaction.channel.topic).ownerId;
  const title = getFraktionsTicketTitle(runtime.config);
  const payload = buildFraktionsTicketPayload({ ownerId, title, claimedBy: null });

  await interaction.update(payload);
  await interaction.channel.send({ content: `🔓 <@${interaction.user.id}> hat das Ticket wieder freigegeben.` });
}

async function handleTicketClose(interaction, runtime) {
  const parsed = parseFraktionsTicketTopic(interaction.channel?.topic);

  if (!parsed) {
    return replyEphemeral(interaction, '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.');
  }

  if (!canCloseTicket(interaction.member, parsed.ownerId, runtime.config.fraktionsTickets.pingRoleId)) {
    return replyEphemeral(interaction, '❌ Du bist nicht berechtigt, dieses Ticket zu schließen.');
  }

  await interaction.reply({ content: '🔒 Dieses Ticket wird in 5 Sekunden geschlossen.' });

  setTimeout(() => {
    interaction.channel.delete().catch((error) => {
      logger.warn('Fraktions-Ticket-Kanal konnte nicht gelöscht werden.', error?.message ?? error);
    });
  }, 5000);
}

async function handleAddPersonButton(interaction, runtime) {
  if (!isValidTicketChannel(interaction.channel)) {
    return replyEphemeral(interaction, '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.');
  }

  if (!isStaffOrAdmin(interaction.member, runtime.config.fraktionsTickets.pingRoleId)) {
    return replyEphemeral(interaction, '❌ Du bist nicht berechtigt, Personen hinzuzufügen.');
  }

  return interaction.reply({ ...buildAddPersonSelectPayload(), flags: MessageFlags.Ephemeral });
}

async function handleRemovePersonButton(interaction, runtime) {
  if (!isValidTicketChannel(interaction.channel)) {
    return replyEphemeral(interaction, '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.');
  }

  if (!isStaffOrAdmin(interaction.member, runtime.config.fraktionsTickets.pingRoleId)) {
    return replyEphemeral(interaction, '❌ Du bist nicht berechtigt, Personen zu entfernen.');
  }

  const ownerId = parseFraktionsTicketTopic(interaction.channel.topic).ownerId;
  return interaction.reply({ ...buildRemovePersonSelectPayload(interaction.channel, ownerId), flags: MessageFlags.Ephemeral });
}

const handlers = [
  {
    name: 'fraktions_ticket_open',
    match: (customId) => customId === 'fraktions_ticket_open',
    execute: (interaction, runtime) => handleTicketOpen(interaction, runtime)
  },
  {
    name: 'fraktions_ticket_claim',
    match: (customId) => customId === 'fraktions_ticket_claim',
    execute: (interaction, runtime) => handleTicketClaim(interaction, runtime)
  },
  {
    name: 'fraktions_ticket_release',
    match: (customId) => customId === 'fraktions_ticket_release',
    execute: (interaction, runtime) => handleTicketRelease(interaction, runtime)
  },
  {
    name: 'fraktions_ticket_close',
    match: (customId) => customId === 'fraktions_ticket_close',
    execute: (interaction, runtime) => handleTicketClose(interaction, runtime)
  },
  {
    name: 'fraktions_ticket_add_person',
    match: (customId) => customId === 'fraktions_ticket_add_person',
    execute: (interaction, runtime) => handleAddPersonButton(interaction, runtime)
  },
  {
    name: 'fraktions_ticket_remove_person',
    match: (customId) => customId === 'fraktions_ticket_remove_person',
    execute: (interaction, runtime) => handleRemovePersonButton(interaction, runtime)
  }
];

export default handlers;
