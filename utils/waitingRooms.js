import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} from 'discord.js';
import { formatGermanDateTime } from './time.js';
import { logger } from './logger.js';
import { canHandle, getDutyRoleId } from './duty.js';

export const WAITING_ROOM_TYPES = {
  highTeam: {
    key: 'highTeam',
    label: 'High Team',
    caseLabel: 'High-Team-Anliegen'
  },
  leitung: {
    key: 'leitung',
    label: 'Leitung',
    caseLabel: 'Leitungs-Anliegen'
  }
};

// Seit der Vereinfachung stecken die Kanäle/Räume jedes Bereichs direkt in
// duty.areas (jeder Bereich = eine Rolle + eigener Kanal + eigene Räume).
export function getWaitingRoomConfig(runtime, type) {
  return runtime.config.duty?.areas?.[type] ?? null;
}

// Liefert alle Dienst-Bereiche, die einen eigenen Voice-Warteraum besitzen.
export function getWaitingRoomAreas(runtime) {
  const areas = runtime.config.duty?.areas ?? {};
  return Object.entries(areas)
    .filter(([, area]) => area?.waitingChannelId)
    .map(([key, area]) => ({
      key,
      label: area.label || WAITING_ROOM_TYPES[key]?.label || key,
      caseLabel: WAITING_ROOM_TYPES[key]?.caseLabel || `${area.label || key}-Anliegen`
    }));
}

export function resolveWaitingRoomPingRoleIds(runtime, type) {
  const roomConfig = getWaitingRoomConfig(runtime, type);
  const roleIds = [];
  if (roomConfig?.pingRoleIds?.length) {
    roleIds.push(...roomConfig.pingRoleIds);
  }
  return [...new Set(roleIds)];
}

async function fetchTextChannel(client, channelId, options = {}) {
  if (!channelId) {
    return null;
  }

  try {
    if (options.force || !client.channels.cache.has(channelId)) {
      const cached = client.channels.cache.get(channelId);
      if (cached && cached?.isTextBased?.()) {
        return cached;
      }
      const channel = await client.channels.fetch(channelId).catch(() => null);
      return channel?.isTextBased?.() ? channel : null;
    }
    return client.channels.cache.get(channelId) ?? null;
  } catch (error) {
    logger.warn(`Textkanal ${channelId} konnte nicht geladen werden.`, error?.message ?? error);
    return null;
  }
}

function buildWaitingRequestPayload(runtime, request, type) {
  const typeConfig = WAITING_ROOM_TYPES[type] ?? WAITING_ROOM_TYPES.highTeam;
  const roomConfig = getWaitingRoomConfig(runtime, type);
  const areaLabel = roomConfig?.label || typeConfig?.label || type;
  const caseLabel = typeConfig?.caseLabel || `${areaLabel}-Anliegen`;
  const container = new ContainerBuilder()
    .setAccentColor(0xe67e22)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${areaLabel} · Wartebereich**`),
      new TextDisplayBuilder().setContent(
        `Ein <@${request.user_id}>-${caseLabel} wurde automatisch erstellt und kann nun bearbeitet werden.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Anliegen-Code:** ${request.request_id.slice(0, 8)}\n**Status:** ${
          request.status === 'taken' ? 'In Bearbeitung' : 'Offen'
        }`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# München RP | VC · ${areaLabel}-Wartebereich · ${formatGermanDateTime(request.created_at)}`
      )
    );

  const row = new ActionRowBuilder();
  const currentMember = runtime.waitingRoomMembers?.[type]?.get?.(request.user_id);

  if (request.status === 'open') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`waiting_take:${type}:${request.request_id}`)
        .setLabel('Annehmen')
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (request.status === 'taken' && currentMember && roomConfig?.activeChannelId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`waiting_end:${type}:${request.request_id}`)
        .setLabel('Schließen')
        .setStyle(ButtonStyle.Danger)
    );
  }

  if (row.components.length) {
    container.addActionRowComponents(row);
  }

  const pingRoleIds = resolveWaitingRoomPingRoleIds(runtime, type);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: pingRoleIds.length ? { parse: [], roles: pingRoleIds } : { parse: [] }
  };
}

async function ensureWaitingRequestMessage(client, runtime, storedRequest, type) {
  const roomConfig = getWaitingRoomConfig(runtime, type);
  const channel = await fetchTextChannel(client, roomConfig?.caseChannelId, { force: true });
  if (!channel) {
    logger.warn(`Wartebereich ${type}: Fallkanal konnte nicht gefunden werden, der Eintrag wurde aber gespeichert.`);
    return storedRequest;
  }

  if (storedRequest.message_id) {
    const message = await channel.messages.fetch(storedRequest.message_id).catch(() => null);
    if (message) {
      return storedRequest;
    }
  }

  const payload = buildWaitingRequestPayload(runtime, storedRequest, type);
  let message = await channel.send(payload).catch((error) => {
    logger.warn(`Wartebereich ${type}: erster Sendeversuch fehlgeschlagen, versuche erneut.`, error?.message ?? error);
    return null;
  });

  if (!message) {
    message = await channel.send(payload).catch((error) => {
      logger.error(`Wartebereich ${type}: Nachricht konnte auch im zweiten Versuch nicht gesendet werden.`, error);
      return null;
    });
  }

  if (message) {
    runtime.db.updateWaitingRequestMessage(runtime.config.guildId, storedRequest.request_id, message.id);
    return { ...storedRequest, request_id: storedRequest.request_id, message_id: message.id };
  }

  return storedRequest;
}

async function openWaitingRequestForMember(client, runtime, member, type) {
  const roomConfig = getWaitingRoomConfig(runtime, type);
  const requestRecord = {
    requestId: randomUUID(),
    guildId: runtime.config.guildId,
    userId: member.id,
    type,
    handlerId: null,
    status: 'open',
    channelId: roomConfig?.waitingChannelId ?? null,
    createdAt: Date.now(),
    takenAt: null,
    endedAt: null,
    messageId: null
  };

  runtime.db.createWaitingRequest(requestRecord);
  runtime.db.expireOpenWaitingRequestsForUser(
    runtime.config.guildId,
    member.id,
    requestRecord.requestId,
    type
  );

  const storedRequest =
    runtime.db.getWaitingRequest(requestRecord.requestId, runtime.config.guildId) ?? {
      ...requestRecord,
      request_id: requestRecord.requestId,
      message_id: null,
      channel_id: roomConfig?.waitingChannelId ?? null
    };

  trackWaitingRoomMember(runtime, type, member);

  const resolved = await ensureWaitingRequestMessage(client, runtime, storedRequest, type);
  await pingWaitingRoomStaff(client, runtime, type).catch(() => null);
  return resolved;
}

async function pingWaitingRoomStaff(client, runtime, type) {
  const roomConfig = getWaitingRoomConfig(runtime, type);
  const dutyRoleId = getDutyRoleId(runtime, type);
  const pingRoleIds = [
    ...(dutyRoleId ? [dutyRoleId] : []),
    ...resolveWaitingRoomPingRoleIds(runtime, type)
  ].filter(Boolean);
  const uniquePingRoleIds = [...new Set(pingRoleIds)];

  if (!roomConfig?.caseChannelId || !uniquePingRoleIds.length) {
    return;
  }

  const channel = await fetchTextChannel(client, roomConfig.caseChannelId);
  if (!channel) {
    return;
  }

  await channel.send({
    content: uniquePingRoleIds.map((roleId) => `<@&${roleId}>`).join(' '),
    allowedMentions: { parse: ['roles'], roles: uniquePingRoleIds }
  }).catch(() => null);
}

export function trackWaitingRoomMember(runtime, type, member) {
  if (!runtime.waitingRoomMembers) {
    runtime.waitingRoomMembers = {};
  }
  if (!runtime.waitingRoomMembers[type]) {
    runtime.waitingRoomMembers[type] = new Map();
  }

  if (member) {
    runtime.waitingRoomMembers[type].set(member.id, member);
  }
}

export async function removeWaitingRoomMember(runtime, type, member) {
  if (member && runtime.waitingRoomMembers?.[type]) {
    runtime.waitingRoomMembers[type].delete(member.id);
  }
}

export async function syncWaitingRooms(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return [];
  }

  const created = [];

  for (const { key: typeKey } of getWaitingRoomAreas(runtime)) {
    const roomConfig = getWaitingRoomConfig(runtime, typeKey);
    if (!roomConfig?.waitingChannelId) {
      continue;
    }

    const room = await guild.channels.fetch(roomConfig.waitingChannelId).catch(() => null);
    if (!room || !room.isVoiceBased?.()) {
      continue;
    }

    for (const member of room.members.values()) {
      if (member.user.bot) {
        continue;
      }

      const activeRequest = runtime.db.getOpenWaitingRequestByUser(
        runtime.config.guildId,
        member.id,
        typeKey
      );
      if (activeRequest) {
        trackWaitingRoomMember(runtime, typeKey, member);
        continue;
      }

      const request = await openWaitingRequestForMember(client, runtime, member, typeKey);
      created.push(request);
    }
  }

  return created;
}

async function handleWaitingTake(interaction, runtime, type, requestId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const roomConfig = getWaitingRoomConfig(runtime, type);
  const allowed = canHandle(interaction.member, runtime, type, roomConfig?.handlerRoleIds ?? []);
  if (!allowed) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Anliegen im ' + (WAITING_ROOM_TYPES[type]?.label ?? type) + '-Wartebereich zu übernehmen.');
  }

  const request = runtime.db.getWaitingRequest(requestId, runtime.config.guildId);
  if (!request || request.status !== 'open' || request.type !== type) {
    return replyEphemeral(interaction, 'Dieses Anliegen wurde bereits übernommen oder geschlossen.');
  }

  const claimed = runtime.db.claimWaitingRequest(runtime.config.guildId, requestId, interaction.user.id, type);
  if (!claimed) {
    return replyEphemeral(interaction, 'Das Anliegen wurde in der Zwischenzeit bereits übernommen.');
  }

  const updatedRequest = runtime.db.getWaitingRequest(requestId, runtime.config.guildId);
  await refreshWaitingRequestMessage(interaction, runtime, updatedRequest, type);

  const member = await interaction.guild.members.fetch(updatedRequest.user_id).catch(() => null);
  if (member && roomConfig?.activeChannelId) {
    await moveMemberToChannel(member, roomConfig.activeChannelId);
  }

  await interaction.editReply({ content: `Du hast das ${WAITING_ROOM_TYPES[type]?.label ?? type}-Anliegen übernommen.` });
}

async function handleWaitingEnd(interaction, runtime, type, requestId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const request = runtime.db.getWaitingRequest(requestId, runtime.config.guildId);
  if (!request || request.status !== 'taken' || request.type !== type) {
    return replyEphemeral(interaction, 'Dieses Anliegen ist nicht mehr in Bearbeitung.');
  }

  const closed = runtime.db.closeWaitingRequest(
    runtime.config.guildId,
    requestId,
    interaction.user.id,
    Date.now(),
    type
  );
  if (!closed) {
    return replyEphemeral(interaction, 'Das Anliegen konnte nicht geschlossen werden.');
  }

  const updatedRequest = runtime.db.getWaitingRequest(requestId, runtime.config.guildId);
  const roomConfig = getWaitingRoomConfig(runtime, type);

  const member = await interaction.guild.members.fetch(updatedRequest.user_id).catch(() => null);
  if (member) {
    if (roomConfig?.finishedChannelId) {
      await moveMemberToChannel(member, roomConfig.finishedChannelId);
    }
    await removeWaitingRoomMember(runtime, type, member);
  }

  await refreshWaitingRequestMessage(interaction, runtime, updatedRequest, type);
  await interaction.editReply({ content: `Das ${WAITING_ROOM_TYPES[type]?.label ?? type}-Anliegen wurde geschlossen und der Benutzer wurde verschoben.` });
}

async function refreshWaitingRequestMessage(interaction, runtime, request, type) {
  if (!request?.message_id) {
    return;
  }

  const roomConfig = getWaitingRoomConfig(runtime, type);
  const channel = await fetchTextChannel(interaction.client, roomConfig?.caseChannelId, { force: true });
  if (!channel) {
    return;
  }

  const message = await channel.messages.fetch(request.message_id).catch(() => null);
  if (!message) {
    return;
  }

  await message.edit(buildWaitingRequestPayload(runtime, request, type)).catch((error) => {
    logger.warn(`Wartebereich ${type}: Anliegen ${request.request_id} konnte nicht aktualisiert werden.`, error?.message ?? error);
  });
}

async function moveMemberToChannel(member, channelId) {
  if (!channelId) {
    return;
  }

  await member.voice.setChannel(channelId).catch((error) => {
    logger.warn(`Benutzer ${member.id} konnte nicht in Kanal ${channelId} verschoben werden.`, error?.message ?? error);
  });
}

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

export {
  openWaitingRequestForMember,
  buildWaitingRequestPayload,
  handleWaitingTake,
  handleWaitingEnd,
  fetchTextChannel
};