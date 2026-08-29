import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  buildWaffenscheinTicketPayload,
  createWaffenscheinTicketChannel,
  getWaffenscheinType,
  parseWaffenscheinTopic
} from '../utils/waffenschein.js';

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

function isStaff(member, runtime) {
  const pingRoleId = runtime.config.waffenschein?.pingRoleId;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  return pingRoleId ? member.roles.cache.has(pingRoleId) : false;
}

/* Button "Waffenschein beantragen" im Panel -> öffnet das Stufen-Auswahlmenü */
async function handleOpen(interaction, runtime) {
  const config = runtime.config.waffenschein || {};
  const types = runtime.config.waffenschein?.types;

  if (!config.panelChannelId) {
    return replyEphemeral(interaction, 'Das Waffenschein-System ist nicht konfiguriert (waffenschein.panelChannelId).');
  }
  if (!config.categoryId) {
    return replyEphemeral(interaction, 'Es ist keine Ticket-Kategorie konfiguriert (waffenschein.categoryId).');
  }
  if (!types || !Object.keys(types).length) {
    return replyEphemeral(interaction, 'Es sind keine Waffenschein-Stufen konfiguriert (waffenschein.types).');
  }

  const { buildWaffenscheinTypeSelectPayload } = await import('../utils/waffenschein.js');
  return interaction.reply(buildWaffenscheinTypeSelectPayload());
}

/* Im Ticket: annehmen -> Rolle + DM */
async function handleAccept(interaction, runtime) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Waffenschein-Anträge anzunehmen.');
  }

  const parsed = parseWaffenscheinTopic(interaction.channel?.topic);
  if (!parsed) {
    return replyEphemeral(interaction, 'Dieser Kanal ist kein gültiges Waffenschein-Ticket.');
  }

  const config = runtime.config.waffenschein || {};
  const acceptRoleId = config.acceptRoleId;
  const type = getWaffenscheinType(runtime.config, parsed.typeKey);
  const bankAccount = config.bankAccount || 'Guar443344';

  if (!acceptRoleId) {
    return replyEphemeral(interaction, 'Es ist keine Annahme-Rolle konfiguriert (waffenschein.acceptRoleId).');
  }

  const member = await interaction.guild.members.fetch(parsed.ownerId).catch(() => null);
  if (!member) {
    return replyEphemeral(interaction, 'Der Antragsteller konnte nicht gefunden werden.');
  }

  try {
    await member.roles.add(acceptRoleId).catch((error) => {
      logger.warn('Waffenschein-Rolle konnte nicht vergeben werden.', error?.message ?? error);
      throw error;
    });
  } catch {
    return replyEphemeral(interaction, 'Die Rolle konnte nicht vergeben werden. Prüfe die Bot-Berechtigungen.');
  }

  // DM an den Antragsteller
  try {
    await member.send(
      `✅ **Dein Waffenschein wurde angenommen!**\nStufe: ${type?.label ?? parsed.typeKey}\n\nFalls noch nicht geschehen, überweise den Betrag an **${bankAccount}** und sende den Beleg im Ticket.`
    );
  } catch {
    logger.warn('DM an den Waffenschein-Antragsteller fehlgeschlagen.', member.id);
  }

  // Ticket-Nachricht aktualisieren
  const messages = await interaction.channel.messages.fetch({ limit: 10 }).catch(() => null);
  const botMessage = messages?.find((msg) => msg.author.id === interaction.client.user.id) ?? null;
  if (botMessage) {
    await botMessage.edit(buildWaffenscheinTicketPayload({
      ownerId: member.id,
      typeKey: parsed.typeKey,
      type,
      bankAccount,
      status: 'accepted'
    })).catch((error) => logger.warn('Waffenschein-Ticket konnte nach Annahme nicht aktualisiert werden.', error?.message ?? error));
  }

  await replyEphemeral(interaction, '✅ Der Antrag wurde angenommen. Der Antragsteller wurde benachrichtigt.');
}

/* Im Ticket: ablehnen -> DM */
async function handleReject(interaction, runtime) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Waffenschein-Anträge abzulehnen.');
  }

  const parsed = parseWaffenscheinTopic(interaction.channel?.topic);
  if (!parsed) {
    return replyEphemeral(interaction, 'Dieser Kanal ist kein gültiges Waffenschein-Ticket.');
  }

  const config = runtime.config.waffenschein || {};
  const type = getWaffenscheinType(runtime.config, parsed.typeKey);
  const bankAccount = config.bankAccount || 'Guar443344';

  const member = await interaction.guild.members.fetch(parsed.ownerId).catch(() => null);
  if (!member) {
    return replyEphemeral(interaction, 'Der Antragsteller konnte nicht gefunden werden.');
  }

  try {
    await member.send(
      `❌ **Dein Waffenschein-Antrag wurde leider abgelehnt.**\nStufe: ${type?.label ?? parsed.typeKey}\n\nFalls du Fragen hast, wende dich bitte an das Team.`
    );
  } catch {
    logger.warn('DM an den Waffenschein-Antragsteller fehlgeschlagen.', member.id);
  }

  const messages = await interaction.channel.messages.fetch({ limit: 10 }).catch(() => null);
  const botMessage = messages?.find((msg) => msg.author.id === interaction.client.user.id) ?? null;
  if (botMessage) {
    await botMessage.edit(buildWaffenscheinTicketPayload({
      ownerId: member.id,
      typeKey: parsed.typeKey,
      type,
      bankAccount,
      status: 'rejected'
    })).catch((error) => logger.warn('Waffenschein-Ticket konnte nach Ablehnung nicht aktualisiert werden.', error?.message ?? error));
  }

  await replyEphemeral(interaction, '❌ Der Antrag wurde abgelehnt. Der Antragsteller wurde benachrichtigt.');
}

/* Ticket schließen */
async function handleClose(interaction, runtime) {
  const parsed = parseWaffenscheinTopic(interaction.channel?.topic);
  if (!parsed) {
    return replyEphemeral(interaction, 'Dieser Kanal ist kein gültiges Waffenschein-Ticket.');
  }
  await interaction.channel.delete().catch((error) => {
    logger.warn('Waffenschein-Ticket konnte nicht gelöscht werden.', error?.message ?? error);
    return replyEphemeral(interaction, 'Das Ticket konnte nicht geschlossen werden.');
  });
  return null;
}

const handlers = [
  {
    name: 'waffenschein_open',
    match: (customId) => customId === 'waffenschein_open',
    execute: (interaction, runtime) => handleOpen(interaction, runtime)
  },
  {
    name: 'waffenschein_accept',
    match: (customId) => customId.startsWith('waffenschein_accept:'),
    execute: (interaction, runtime) => handleAccept(interaction, runtime)
  },
  {
    name: 'waffenschein_reject',
    match: (customId) => customId.startsWith('waffenschein_reject:'),
    execute: (interaction, runtime) => handleReject(interaction, runtime)
  },
  {
    name: 'waffenschein_close',
    match: (customId) => customId.startsWith('waffenschein_close:'),
    execute: (interaction, runtime) => handleClose(interaction, runtime)
  }
];

export default handlers;
