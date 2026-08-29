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
  StringSelectMenuBuilder
} from 'discord.js';
import { logger } from './logger.js';
import { formatGermanDateTime } from './time.js';

const TOPIC_PREFIX = 'waffenschein-ticket:';

/* ============================================================
 * CONFIG-HELFER
 * ============================================================ */

export function getWaffenscheinTypes(config) {
  const types = config.waffenschein?.types;
  if (!types || typeof types !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(types).map(([key, value]) => [
      String(key).toLowerCase(),
      typeof value === 'string'
        ? { label: value, description: '', price: '', roleId: '' }
        : {
            label: value?.label ?? String(key),
            description: value?.description ?? '',
            price: value?.price ?? '',
            roleId: value?.roleId ?? ''
          }
    ])
  );
}

export function getWaffenscheinType(config, typeKey) {
  return getWaffenscheinTypes(config)[String(typeKey).toLowerCase()] ?? null;
}

/* ============================================================
 * RENDERER
 * ============================================================ */

export function buildWaffenscheinPanelPayload() {
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🔫 **Waffenschein beantragen**'),
      new TextDisplayBuilder().setContent(
        [
          'Du möchtest einen Waffenschein beantragen?',
          'Klicke auf den Button und wähle dann zwischen den Stufen A, B und C.',
          'Ein Teammitglied kümmert sich um dein Anliegen.'
        ].join('\n')
      )
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId('waffenschein_open')
        .setLabel('Waffenschein beantragen')
        .setEmoji('🔫')
        .setStyle(ButtonStyle.Primary)
    );

  const container = new ContainerBuilder()
    .setAccentColor(0xe67e22)
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Waffenschein-System'));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildWaffenscheinTypeSelectPayload(config) {
  const types = getWaffenscheinTypes(config);

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('waffenschein_select')
      .setPlaceholder('Wähle deine Waffenschein-Stufe aus.')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        ...Object.entries(types).map(([key, type]) => ({
          label: type.label || `Waffenschein ${String(key).toUpperCase()}`,
          value: String(key).toLowerCase(),
          description: (type.description || '').slice(0, 100),
          emoji: '🔫'
        }))
      )
  );

  return { content: 'Welchen Waffenschein möchtest du beantragen?', components: [row] };
}

function buildTicketControlRows(ownerId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`waffenschein_accept:${ownerId}`)
      .setLabel('Annehmen')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`waffenschein_reject:${ownerId}`)
      .setLabel('Ablehnen')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`waffenschein_close:${ownerId}`)
      .setLabel('Schließen')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

export function buildWaffenscheinTicketPayload({ ownerId, typeKey, type, bankAccount, status = 'open' }) {
  const typeLabel = type?.label ? `**${type.label}**` : '**(ohne Stufe)**';
  const price = type?.price ? `\n**Kosten:** ${type.price}` : '';
  const description = type?.description ? `\n${type.description}` : '';

  const statusLine =
    status === 'accepted'
      ? '✅ **Angenommen** – Der Waffenschein wurde freigeschaltet.'
      : status === 'rejected'
        ? '❌ **Abgelehnt** – Der Antrag wurde abgelehnt.'
        : '⏳ **Offen** – Warte auf die Bearbeitung durch das Team.';

  const container = new ContainerBuilder()
    .setAccentColor(status === 'accepted' ? 0x2ecc71 : status === 'rejected' ? 0xe74c3c : 0xe67e22)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🔫 **Waffenschein-Ticket**'),
      new TextDisplayBuilder().setContent(
        [
          `Willkommen <@${ownerId}>!`,
          `**Gewählte Stufe:** ${typeLabel}${price}${description}`,
          '',
          `**Zahlung:** Bitte überweise den Betrag auf **${bankAccount}** und sende den Überweisungsbeleg **hier im Ticket** als Nachricht/Bild.`,
          '',
          statusLine
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Waffenschein-Ticket · ${formatGermanDateTime(Date.now())}`)
    );

  if (status === 'open') {
    for (const row of buildTicketControlRows(ownerId)) {
      container.addActionRowComponents(row);
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/* ============================================================
 * TICKET-HELFER
 * ============================================================ */

export function getWaffenscheinTopic(ownerId, typeKey) {
  return `${TOPIC_PREFIX}${ownerId}:${typeKey}`;
}

export function parseWaffenscheinTopic(topic) {
  if (!topic || !topic.startsWith(TOPIC_PREFIX)) {
    return null;
  }
  const rest = topic.slice(TOPIC_PREFIX.length);
  const [ownerId, typeKey] = rest.split(':');
  return { ownerId, typeKey: typeKey || 'a' };
}

export function isWaffenscheinTicketChannel(channel) {
  return Boolean(parseWaffenscheinTopic(channel?.topic));
}

export function findOpenWaffenscheinTicket(guild, userId, categoryId) {
  return guild.channels.cache.find(
    (channel) =>
      channel.parentId === categoryId &&
      parseWaffenscheinTopic(channel.topic)?.ownerId === userId
  ) ?? null;
}

export async function createWaffenscheinTicketChannel(guild, member, typeKey, config) {
  const { categoryId, pingRoleId, bankAccount, acceptRoleId } = config.waffenschein;
  const type = getWaffenscheinType(config, typeKey);

  const existing = findOpenWaffenscheinTicket(guild, member.id, categoryId);
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
    name: `waffenschein-${safeName}`,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    topic: getWaffenscheinTopic(member.id, typeKey),
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
  await channel.send(buildWaffenscheinTicketPayload({
    ownerId: member.id,
    typeKey,
    type,
    bankAccount: bankAccount || 'Guar443344',
    status: 'open'
  }));

  return { channel, created: true };
}
