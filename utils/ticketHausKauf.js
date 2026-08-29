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

// Präfix für den Kanal-Topic, um den Ticket-Ersteller wiederzufinden
const TOPIC_PREFIX = 'haus-kauf-ticket:';

export function buildTicketHausKaufPanelPayload() {
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🏠 **Haus kaufen**'),
      new TextDisplayBuilder().setContent(
        [
          'Du möchtest ein Haus kaufen?',
          'Klicke auf den Button unten, um ein Ticket zu erstellen.',
          'Ein Mitglied des Teams meldet sich dann bei dir.'
        ].join('\n')
      )
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId('ticket_hauskauf_open')
        .setLabel('Haus kaufen')
        .setEmoji('🏠')
        .setStyle(ButtonStyle.Success)
    );

  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Immobilien-Ticket-System'));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildTicketControlRows({ claimedBy = null } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_hauskauf_claim')
      .setLabel('Übernehmen')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(claimedBy)),
    new ButtonBuilder()
      .setCustomId('ticket_hauskauf_release')
      .setLabel('Freigeben')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedBy),
    new ButtonBuilder()
      .setCustomId('ticket_hauskauf_close')
      .setLabel('Schließen')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_hauskauf_add_person')
      .setLabel('Person hinzufügen')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket_hauskauf_remove_person')
      .setLabel('Person entfernen')
      .setEmoji('➖')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

export function buildTicketHausKaufChannelPayload(userId, { claimedBy = null } = {}) {
  const footerText = claimedBy
    ? `Übernommen von ${claimedBy.displayName ?? claimedBy.user?.username ?? claimedBy.id}`
    : 'Noch nicht übernommen';

  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🏠 **Hauskauf-Ticket**'),
      new TextDisplayBuilder().setContent(
        [
          `Willkommen <@${userId}>!`,
          'Bitte beschreibe, welches Haus du kaufen möchtest.',
          'Ein Teammitglied kümmert sich in Kürze um dein Anliegen.'
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));

  for (const row of buildTicketControlRows({ claimedBy })) {
    container.addActionRowComponents(row);
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildAddPersonSelectPayload() {
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('ticket_hauskauf_adduser_select')
      .setPlaceholder('Wähle eine Person aus, die hinzugefügt werden soll.')
      .setMinValues(1)
      .setMaxValues(1)
  );

  return { content: 'Wen möchtest du dem Ticket hinzufügen?', components: [row] };
}

export function buildRemovePersonSelectPayload(channel, ownerId) {
  const options = getTicketMembers(channel).filter((id) => id !== ownerId);

  if (!options.length) {
    return { content: 'Es sind aktuell keine zusätzlichen Personen im Ticket.', components: [] };
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_hauskauf_removeuser_select')
      .setPlaceholder('Wähle eine Person aus, die entfernt werden soll.')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options.map((id) => ({ label: `Nutzer-ID: ${id}`, value: id })))
  );

  return { content: 'Wen möchtest du aus dem Ticket entfernen?', components: [row] };
}

export function getTicketMembers(channel) {
  return channel.permissionOverwrites.cache
    .filter((overwrite) =>
      overwrite.type === OverwriteType.Member &&
      overwrite.id !== channel.client.user.id)
    .map((overwrite) => overwrite.id);
}

export function findOpenTicketChannel(guild, userId, categoryId) {
  return guild.channels.cache.find(
    (channel) =>
      channel.parentId === categoryId &&
      channel.topic === `${TOPIC_PREFIX}${userId}`
  ) ?? null;
}

export function getTicketTopic(userId) {
  return `${TOPIC_PREFIX}${userId}`;
}

export function getTicketOwnerIdFromTopic(topic) {
  if (!topic || !topic.startsWith(TOPIC_PREFIX)) {
    return null;
  }
  return topic.slice(TOPIC_PREFIX.length);
}

export async function createHausKaufTicketChannel(guild, member, config) {
  const { categoryId, pingRoleId } = config.hausTicket;

  const existing = findOpenTicketChannel(guild, member.id, categoryId);
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
    name: `haus-kauf-${safeName}`,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    topic: getTicketTopic(member.id),
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
  await channel.send(buildTicketHausKaufChannelPayload(member.id));

  return { channel, created: true };
}