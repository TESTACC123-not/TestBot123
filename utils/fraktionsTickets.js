import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} from 'discord.js';
import { logger } from './logger.js';
import { formatGermanDateTime } from './time.js';

const TOPIC_PREFIX = 'fraktions-ticket:';

/* ============================================================
 * CONFIG-HELFER
 * ============================================================ */

export function getFraktionsTicketTitle(config) {
  return config.fraktionsTickets?.title ?? 'Fraktions-Anfrage';
}

/* ============================================================
 * RENDERER
 * ============================================================ */

export function buildFraktionsTicketPanelPayload() {
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🏛️ **Fraktions-Anfrage stellen**'),
      new TextDisplayBuilder().setContent(
        [
          'Du hast eine Anfrage an die Fraktion?',
          'Klicke auf den Button, um ein Ticket zu erstellen.',
          'Ein Teammitglied wird deine Anfrage hier beantworten.'
        ].join('\n')
      )
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId('fraktions_ticket_open')
        .setLabel('Anfrage erstellen')
        .setEmoji('📩')
        .setStyle(ButtonStyle.Primary)
    );

  const container = new ContainerBuilder()
    .setAccentColor(0x3498db)
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Fraktions-Tickets'));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildTicketControlRows({ claimedBy = null } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fraktions_ticket_claim')
      .setLabel('Übernehmen')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(claimedBy)),
    new ButtonBuilder()
      .setCustomId('fraktions_ticket_release')
      .setLabel('Freigeben')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedBy),
    new ButtonBuilder()
      .setCustomId('fraktions_ticket_close')
      .setLabel('Schließen')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fraktions_ticket_add_person')
      .setLabel('Person hinzufügen')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fraktions_ticket_remove_person')
      .setLabel('Person entfernen')
      .setEmoji('➖')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

export function buildFraktionsTicketPayload({ ownerId, title, status = 'open', claimedBy = null } = {}) {
  const statusLine =
    status === 'closed'
      ? '🔒 **Geschlossen** – Dieses Ticket wurde beendet.'
      : '⏳ **Offen** – Warte auf die Bearbeitung durch das Team.';

  const claimedLine = claimedBy
    ? `Übernommen von ${claimedBy.displayName ?? claimedBy.user?.username ?? claimedBy.id}`
    : 'Noch nicht übernommen';

  const container = new ContainerBuilder()
    .setAccentColor(status === 'closed' ? 0x95a5a6 : 0x3498db)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`🏛️ **${title}**`),
      new TextDisplayBuilder().setContent(
        [
          `Willkommen <@${ownerId}>!`,
          '',
          'Schreibe hier einfach deine Anfrage. Ein Teammitglied antwortet dir in diesem Ticket.',
          '',
          statusLine
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${claimedLine} · ${formatGermanDateTime(Date.now())}`)
    );

  if (status === 'open') {
    for (const row of buildTicketControlRows({ claimedBy })) {
      container.addActionRowComponents(row);
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildAddPersonSelectPayload() {
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('fraktions_ticket_adduser_select')
      .setPlaceholder('Wähle eine Person aus, die hinzugefügt werden soll.')
      .setMinValues(1)
      .setMaxValues(1)
  );

  return { content: 'Wen möchtest du dem Ticket hinzufügen?', components: [row] };
}

export function buildRemovePersonSelectPayload(channel, ownerId) {
  const options = getFraktionsTicketMembers(channel).filter((id) => id !== ownerId);

  if (!options.length) {
    return { content: 'Es sind aktuell keine zusätzlichen Personen im Ticket.', components: [] };
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('fraktions_ticket_removeuser_select')
      .setPlaceholder('Wähle eine Person aus, die entfernt werden soll.')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options.map((id) => ({ label: `Nutzer-ID: ${id}`, value: id })))
  );

  return { content: 'Wen möchtest du aus dem Ticket entfernen?', components: [row] };
}

export function getFraktionsTicketMembers(channel) {
  return channel.permissionOverwrites.cache
    .filter((overwrite) =>
      overwrite.type === OverwriteType.Member &&
      overwrite.id !== channel.client.user.id)
    .map((overwrite) => overwrite.id);
}

/* ============================================================
 * TICKET-HELFER
 * ============================================================ */

export function getFraktionsTicketTopic(ownerId) {
  return `${TOPIC_PREFIX}${ownerId}`;
}

export function parseFraktionsTicketTopic(topic) {
  if (!topic || !topic.startsWith(TOPIC_PREFIX)) {
    return null;
  }
  return { ownerId: topic.slice(TOPIC_PREFIX.length) };
}

export function isFraktionsTicketChannel(channel) {
  return Boolean(parseFraktionsTicketTopic(channel?.topic));
}

export function findOpenFraktionsTicket(guild, userId, categoryId) {
  return guild.channels.cache.find(
    (channel) =>
      channel.parentId === categoryId &&
      parseFraktionsTicketTopic(channel.topic)?.ownerId === userId
  ) ?? null;
}

export async function createFraktionsTicketChannel(guild, member, config) {
  const { categoryId, pingRoleId } = config.fraktionsTickets;
  const title = getFraktionsTicketTitle(config);

  const existing = findOpenFraktionsTicket(guild, member.id, categoryId);
  if (existing) {
    return { channel: existing, created: false };
  }

  const safeName = member.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || member.id;

  const channel = await guild.channels.create({
    name: `fraktion-${safeName}`,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    topic: getFraktionsTicketTopic(member.id),
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: member.id,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      },
      {
        id: pingRoleId,
        type: OverwriteType.Role,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ]
  });

  await channel.send({ content: `<@&${pingRoleId}> <@${member.id}>` });
  await channel.send(buildFraktionsTicketPayload({ ownerId: member.id, title, status: 'open' }));

  return { channel, created: true };
}
