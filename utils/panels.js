import { randomUUID } from 'node:crypto';
import {
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { buildActiveAbsencesEmbeds, buildAbsencePanelPayload, buildDutyPanelPayload, buildFlyPanelPayload, buildSupportCaseChannelMessage, buildSupportLeaderboardPayload, buildTeamListEmbeds, buildVerifyPanelPayload } from './renderers.js';
import * as trainerDashboard from './trainerDashboard.js';
import { logger, sendLog } from './logger.js';
import { syncWaitingRooms } from './waitingRooms.js';
import { refreshBewerbungPanel, expireBewerbungRejectRoles } from './bewerbung.js';

async function fetchTextChannel(client, channelId, options = {}) {
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId, { force: Boolean(options.force) }).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

function resolveSupportPingRoleIds(runtime) {
  const dutyRoleId = runtime.config.duty?.areas?.support?.roleId ?? '';
  return [...new Set([
    ...(dutyRoleId ? [dutyRoleId] : []),
    ...(runtime.config.support.supporterRoleIds ?? []),
    ...(runtime.config.roles.supporterRoleIds ?? [])
  ].filter(Boolean))];
}

function hasRenderableContent(payload) {
  return Boolean(
    payload?.content?.trim() ||
    (Array.isArray(payload?.embeds) && payload.embeds.length > 0) ||
    (Array.isArray(payload?.components) && payload.components.length > 0) ||
    (Array.isArray(payload?.files) && payload.files.length > 0)
  );
}

function buildFallbackPanelPayload(panelKey) {
  const titles = {
    trainerAssignments: 'ASB-Zuordnungen',
    trainerDashboard: 'Ausbilder-Dashboard',
    realEstate: 'Immobilienliste',
    teamList: 'Teamliste'
  };

  const container = new ContainerBuilder()
    .setAccentColor(0xe67e22)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${titles[panelKey] ?? `Panel ${panelKey}`}**`),
      new TextDisplayBuilder().setContent('Dieses Panel konnte gerade keine Daten laden. Bitte später erneut versuchen oder das Panel neu synchronisieren.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${new Date().toLocaleString('de-DE')}`));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function resolveCurrentTrainerPairings(guild, runtime) {
  const resolveTrainerAsbRole = trainerDashboard.resolveTrainerAsbRole ?? trainerDashboard.resolveTrainerAsblRole;
  const resolveTrainerTargetRole = trainerDashboard.resolveTrainerTargetRole;
  const asbRole = resolveTrainerAsbRole?.(runtime.config) ?? null;
  const tsupRole = resolveTrainerTargetRole?.(runtime.config) ?? null;

  if (!asbRole?.id || !tsupRole?.id) {
    return null;
  }

  const asbMembers = Array.from(
    guild.members.cache
      .filter((member) => member.roles.cache.has(asbRole.id))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .values()
  );

  const tsupMembers = Array.from(
    guild.members.cache
      .filter((member) => member.roles.cache.has(tsupRole.id))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .values()
  );

  return {
    asbRole,
    tsupRole,
    asbMembers,
    tsupMembers
  };
}

function buildBalancedTrainerAssignments(asbMembers, tsupMembers) {
  const grouped = new Map(asbMembers.map((member) => [member.id, []]));

  if (!asbMembers.length || !tsupMembers.length) {
    return grouped;
  }

  for (let index = 0; index < tsupMembers.length; index += 1) {
    const tsupMember = tsupMembers[index];
    if (!tsupMember) {
      continue;
    }

    let assignedAsb = null;
    for (let offset = 0; offset < asbMembers.length; offset += 1) {
      const candidate = asbMembers[(index + offset) % asbMembers.length];
      if (candidate.id !== tsupMember.id) {
        assignedAsb = candidate;
        break;
      }
    }

    if (assignedAsb) {
      grouped.get(assignedAsb.id)?.push(tsupMember);
    }
  }

  return grouped;
}

function clearTrainerAssignments(runtime) {
  if (runtime.db?.db?.prepare) {
    return runtime.db.db.prepare(`
      DELETE FROM trainer_assignments
      WHERE guild_id = ?
    `).run(runtime.config.guildId).changes;
  }

  return 0;
}

async function buildTrainerAssignmentListPayloadFromRows(guild, runtime) {
  const timestamp = new Date().toLocaleString('de-DE');
  const resolved = await resolveCurrentTrainerPairings(guild, runtime);
  if (!resolved) {
    const container = new ContainerBuilder()
      .setAccentColor(0x3498db)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**ASB-Zuordnungen**'),
        new TextDisplayBuilder().setContent('Die ASB- oder T-Sup-Rolle konnte in der config.json nicht gefunden werden.')
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ASB-Zuordnungen | Fehler · ${timestamp}`));

    return [{ flags: MessageFlags.IsComponentsV2, components: [container] }];
  }

  const { asbRole, asbMembers, tsupMembers } = resolved;
  if (!asbMembers.length) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe67e22)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**ASB-Zuordnungen**'),
        new TextDisplayBuilder().setContent(`Aktuell hat niemand die Rolle ${asbRole.label}.`)
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ASB-Zuordnungen | Live-Daten · ${timestamp}`));

    return [{ flags: MessageFlags.IsComponentsV2, components: [container] }];
  }

  const groupedAssignments = buildBalancedTrainerAssignments(asbMembers, tsupMembers);
  const lines = asbMembers.map((asbMember, index) => {
    const assignedTsups = groupedAssignments.get(asbMember.id) ?? [];
    const tsupLabel = assignedTsups.length
      ? assignedTsups.map((member) => `<@${member.id}>`).join(', ')
      : 'Kein T-Sup zugeordnet';

    return `• ASB: <@${asbMember.id}> (${assignedTsups.length})\n  T-Sups: ${tsupLabel}`;
  });

  // Components V2 begrenzt den sichtbaren Text auf 4000 Zeichen PRO NACHRICHT, daher konservativ
  // auf 3400 Zeichen Inhalt pro Teil gechunkt und je Teil eine eigene Nachricht gebaut.
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > 3400 && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }

  const limitedChunks = chunks.slice(0, 10);
  const totalParts = limitedChunks.length;

  return limitedChunks.map((chunk, index) => ({
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(0x3498db)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${index === 0 ? 'ASB-Zuordnungen' : `ASB-Zuordnungen ${index + 1}/${totalParts}`}**`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ASB-Zuordnungen | Live-Daten · ${timestamp}`))
    ]
  }));
}

async function syncAutomaticTrainerAssignments(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return 0;
  }

  await guild.members.fetch().catch(() => null);

  const resolved = await resolveCurrentTrainerPairings(guild, runtime);
  if (!resolved) {
    return 0;
  }

  const { asbMembers, tsupMembers } = resolved;
  clearTrainerAssignments(runtime);
  const groupedAssignments = buildBalancedTrainerAssignments(asbMembers, tsupMembers);

  let created = 0;
  for (const [asbId, assignedTsups] of groupedAssignments.entries()) {
    for (const tsupMember of assignedTsups) {
      if (runtime.db.ensureTrainerAssignment(runtime.config.guildId, asbId, tsupMember.id, null)) {
        created += 1;
      }
    }
  }

  return created;
}

async function upsertPanelMessage(client, runtime, panelKey, channelId, payload) {
  const guildId = runtime.config.guildId;
  const stored = runtime.db.getPanelMessage(panelKey);
  const configuredPanel = runtime.config.panels[panelKey] ?? {};
  const resolvedChannelId = channelId || stored?.channel_id || configuredPanel.channelId;
  const channel = await fetchTextChannel(client, resolvedChannelId);
  const safePayload = hasRenderableContent(payload) ? payload : buildFallbackPanelPayload(panelKey);

  if (!channel) {
    if (!panelKey.startsWith('teamList')) {
      logger.warn(`Panel ${panelKey}: Textkanal konnte nicht gefunden werden.`);
    }
    return null;
  }

  const candidateMessageId = stored?.message_id || configuredPanel.messageId;
  if (candidateMessageId) {
    const message = await channel.messages.fetch(candidateMessageId).catch(() => null);
    if (message) {
      await message.edit(safePayload).catch((error) => {
        logger.warn(`Panel ${panelKey} konnte nicht bearbeitet werden, sende neu.`, error?.message ?? error);
      });

      runtime.db.upsertPanelMessage(panelKey, guildId, channel.id, message.id);
      return message;
    }
  }

  try {
    const sent = await channel.send(safePayload);
    runtime.db.upsertPanelMessage(panelKey, guildId, channel.id, sent.id);
    return sent;
  } catch (error) {
    logger.error(`Panel ${panelKey} konnte nicht gesendet werden.`, error);
    return null;
  }
}

// Components V2 begrenzt den sichtbaren Text auf 4000 Zeichen PRO NACHRICHT (nicht pro Container).
// Panels mit potenziell langen Inhalten (Teamliste, aktive Abmeldungen, ASB-Zuordnungen) liefern daher
// ein Array von Einzel-Payloads (je ein Container pro Nachricht), die hier auf mehrere echte Discord-
// Nachrichten verteilt werden. Jeder Teil wird unter panelKey#<index> gespeichert; schrumpft die Liste,
// werden überzählige alte Teile gelöscht.
async function upsertMultiPartPanelMessages(client, runtime, panelKey, channelId, payloads) {
  const parts = payloads.length ? payloads : [buildFallbackPanelPayload(panelKey)];
  const previousCountRaw = runtime.db.getSetting(`panelParts:${panelKey}`);
  const previousCount = previousCountRaw ? Number(previousCountRaw) : 0;

  const sentMessages = [];
  for (let index = 0; index < parts.length; index += 1) {
    const message = await upsertPanelMessage(client, runtime, `${panelKey}#${index}`, channelId, parts[index]);
    if (message) {
      sentMessages.push(message);
    }
  }

  for (let index = parts.length; index < previousCount; index += 1) {
    const partKey = `${panelKey}#${index}`;
    const stored = runtime.db.getPanelMessage(partKey);
    if (stored) {
      const oldChannel = await fetchTextChannel(client, stored.channel_id);
      const oldMessage = oldChannel ? await oldChannel.messages.fetch(stored.message_id).catch(() => null) : null;
      await oldMessage?.delete().catch(() => null);
      runtime.db.deletePanelMessage(partKey);
    }
  }

  runtime.db.setSetting(`panelParts:${panelKey}`, String(parts.length));

  // Verwaiste Panel-Nachrichten im Kanal aufräumen (z. B. nach Server-Reinstall,
  // wenn die Datenbank mit den Nachrichten-IDs verloren ging und alte doppelte
  // Blöcke übrig geblieben sind). Nur echte Bot-Nachrichten dieses Panels werden
  // entfernt; die gerade verwalteten Nachrichten bleiben stehen.
  if (sentMessages.length) {
    const channel = await fetchTextChannel(client, channelId);
    if (channel) {
      const sentIds = new Set(sentMessages.map((m) => m.id));
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => new Map());
      for (const message of recent.values()) {
        if (sentIds.has(message.id)) {
          continue;
        }
        if (!message.author || message.author.id !== client.user?.id) {
          continue;
        }
        const text = `${message.content ?? ''} ${message.embeds?.map((e) => e.description ?? '').join(' ')}`;
        if (text.includes('Teamliste')) {
          await message.delete().catch(() => null);
        }
      }
    }
  }

  return sentMessages;
}

async function refreshSupportLeaderboardPanel(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return null;
  }

  await guild.members.fetch().catch(() => null);
  const rows = runtime.db.getSupportLeaderboard(runtime.config.guildId, 10);
  return upsertPanelMessage(
    client,
    runtime,
    'supportLeaderboard',
    runtime.config.panels.supportLeaderboard.channelId,
    buildSupportLeaderboardPayload(rows, guild)
  );
}

async function refreshDutyPanel(client, runtime) {
  const channelId =
    runtime.config.duty?.panelChannelId ||
    runtime.config.panels.onDuty.channelId;

  return upsertPanelMessage(
    client,
    runtime,
    'onDuty',
    channelId,
    buildDutyPanelPayload(runtime.config.duty ?? {})
  );
}

async function refreshVerifyPanel(client, runtime) {
  return upsertPanelMessage(
    client,
    runtime,
    'verify',
    runtime.config.panels.verify.channelId,
    buildVerifyPanelPayload()
  );
}

async function refreshFlyPanel(client, runtime) {
  return upsertPanelMessage(
    client,
    runtime,
    'fly',
    runtime.config.panels.fly.channelId,
    buildFlyPanelPayload()
  );
}

async function refreshAbsencePanel(client, runtime) {
  return upsertPanelMessage(
    client,
    runtime,
    'absence',
    runtime.config.panels.absence.channelId,
    buildAbsencePanelPayload()
  );
}

async function refreshActiveAbsencePanel(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return null;
  }

  await guild.members.fetch().catch(() => null);
  const absences = runtime.db.getActiveAbsences(runtime.config.guildId);
  const payloads = buildActiveAbsencesEmbeds({ absences, guild });
  return upsertMultiPartPanelMessages(
    client,
    runtime,
    'activeAbsences',
    runtime.config.panels.activeAbsences.channelId,
    payloads
  );
}

async function refreshTeamListPanel(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return null;
  }

  const fetchedMembers = await guild.members.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const members = fetchedMembers && fetchedMembers.size
    ? Array.from(fetchedMembers.values())
    : Array.from(guild.members.cache.values());

  const stored = runtime.db.getPanelMessage('teamList#0');
  const configuredPanel = runtime.config.panels.teamList ?? {};
  let resolvedChannelId = null;

  for (const candidateId of [configuredPanel.channelId, stored?.channel_id].filter(Boolean)) {
    const candidate = await guild.channels.fetch(candidateId).catch(() => null);
    if (candidate?.isTextBased?.() && !candidate.isDMBased?.()) {
      resolvedChannelId = candidate.id;
      break;
    }
  }

  if (!resolvedChannelId) {
    const fallbackNames = new Set(['teamliste', 'team list', 'team-list']);
    const foundChannel = guild.channels.cache.find((channel) => {
      if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
        return false;
      }

      return fallbackNames.has(channel.name.toLowerCase());
    });

    if (foundChannel) {
      resolvedChannelId = foundChannel.id;
    } else if (guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      const createdChannel = await guild.channels.create({
        name: 'teamliste',
        type: ChannelType.GuildText,
        parent: runtime.config.categories.teamCategoryId || undefined,
        reason: 'Automatisch erstellte Teamliste für München RP | VC'
      }).catch((error) => {
        logger.warn('Teamlisten-Kanal konnte nicht automatisch erstellt werden.', error?.message ?? error);
        return null;
      });

      if (createdChannel) {
        resolvedChannelId = createdChannel.id;
      }
    }
  }

  if (!resolvedChannelId) {
    return null;
  }

  const rows = new Map(runtime.db.listRobloxNames(runtime.config.guildId).map((row) => [row.user_id, row]));

  const payloads = buildTeamListEmbeds({ guild, config: runtime.config, rows, members });
  return upsertMultiPartPanelMessages(
    client,
    runtime,
    'teamList',
    resolvedChannelId,
    payloads
  );
}

async function refreshTrainerDashboardPanel(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return null;
  }

  await guild.channels.fetch().catch(() => null);

  const stored = runtime.db.getPanelMessage('trainerDashboard');
  const configuredPanel = runtime.config.panels.trainerDashboard ?? {};
  let resolvedChannelId = null;

  for (const candidateId of [configuredPanel.channelId, stored?.channel_id].filter(Boolean)) {
    const candidate = await guild.channels.fetch(candidateId).catch(() => null);
    if (candidate?.isTextBased?.() && !candidate.isDMBased?.()) {
      resolvedChannelId = candidate.id;
      break;
    }
  }

  if (!resolvedChannelId) {
    const fallbackNames = new Set(['ausbilder-dashboard', 'ausbilder dashboard', 'trainer-dashboard']);
    const foundChannel = guild.channels.cache.find((channel) => {
      if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
        return false;
      }

      return fallbackNames.has(channel.name.toLowerCase());
    });

    if (foundChannel) {
      resolvedChannelId = foundChannel.id;
    } else if (guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      const createdChannel = await guild.channels.create({
        name: 'ausbilder-dashboard',
        type: ChannelType.GuildText,
        parent: runtime.config.categories.teamCategoryId || undefined,
        reason: 'Automatisch erstelltes Ausbilder-Dashboard für München RP | VC'
      }).catch((error) => {
        logger.warn('Ausbilder-Dashboard-Kanal konnte nicht automatisch erstellt werden.', error?.message ?? error);
        return null;
      });

      if (createdChannel) {
        resolvedChannelId = createdChannel.id;
      }
    }
  }

  if (!resolvedChannelId) {
    return null;
  }

  const payload = trainerDashboard.buildTrainerDashboardPanelPayload?.() ?? buildFallbackPanelPayload('trainerDashboard');
  return upsertPanelMessage(
    client,
    runtime,
    'trainerDashboard',
    resolvedChannelId,
    payload
  );
}

async function refreshTrainerAssignmentsPanel(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return null;
  }

  await guild.channels.fetch().catch(() => null);
  await guild.members.fetch().catch(() => null);

  const stored = runtime.db.getPanelMessage('trainerAssignments#0');
  const configuredPanel = runtime.config.panels.trainerAssignments ?? { channelId: '', messageId: '' };
  let resolvedChannelId = null;

  for (const candidateId of [configuredPanel.channelId, stored?.channel_id].filter(Boolean)) {
    const candidate = await guild.channels.fetch(candidateId).catch(() => null);
    if (candidate?.isTextBased?.() && !candidate.isDMBased?.()) {
      resolvedChannelId = candidate.id;
      break;
    }
  }

  if (!resolvedChannelId) {
    return null;
  }

  const payloads = await buildTrainerAssignmentListPayloadFromRows(guild, runtime);
  return upsertMultiPartPanelMessages(
    client,
    runtime,
    'trainerAssignments',
    resolvedChannelId,
    payloads
  );
}

async function expireStaleSupportCases(runtime) {
  const STALE_AFTER_MS = 30 * 60_000; // 30 Minuten
  const changed = runtime.db.expireStaleOpenSupportCases(runtime.config.guildId, STALE_AFTER_MS);
  if (changed > 0) {
    logger.info(`${changed} veraltete, nicht übernommene Supportfälle wurden automatisch als abgelaufen markiert.`);
  }
  return changed;
}

async function syncOpenSupportCases(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const cases = runtime.db.getActiveSupportCases(runtime.config.guildId);
  const channel = await fetchTextChannel(client, runtime.config.channels.supportChannelId);
  if (!channel) {
    logger.warn('Supportkanal konnte für aktive Fälle nicht gefunden werden.');
    return;
  }

  for (const supportCase of cases) {
    const payload = buildSupportCaseChannelMessage(supportCase, {
      pingRoleIds: resolveSupportPingRoleIds(runtime)
    });
    const existingMessageId = supportCase.message_id;

    if (existingMessageId) {
      const message = await channel.messages.fetch(existingMessageId).catch(() => null);
      if (message) {
        await message.edit(payload).catch((error) => {
          logger.warn(`Supportfall ${supportCase.case_id} konnte nicht aktualisiert werden.`, error?.message ?? error);
        });
      }
    }
    else {
      logger.info(`Supportfall ${supportCase.case_id} wird nach dem Neustart nicht erneut gesendet, da keine Nachrichten-ID gespeichert ist.`);
    }
  }
}

async function openSupportCaseForMember(client, runtime, member) {
  const caseRecord = {
    caseId: randomUUID(),
    guildId: runtime.config.guildId,
    userId: member.id,
    supporterId: null,
    status: 'open',
    createdAt: Date.now(),
    takenAt: null,
    endedAt: null,
    supportChannelId: runtime.config.channels.supportChannelId,
    messageId: null
  };

  runtime.db.createSupportCase(caseRecord);
  // Alte, noch nicht übernommene Fälle desselben Users werden automatisch als abgelaufen markiert,
  // damit sich beim erneuten Betreten des Warteraums keine Fälle endlos anhäufen.
  runtime.db.expireOpenSupportCasesForUser(runtime.config.guildId, member.id, caseRecord.caseId);

  // Frisch aus der Datenbank laden, damit die Feldnamen (z.B. case_id statt caseId) garantiert stimmen.
  const storedCase = runtime.db.getSupportCase(caseRecord.caseId, runtime.config.guildId) ?? {
    ...caseRecord,
    case_id: caseRecord.caseId
  };

  const channel = await fetchTextChannel(client, runtime.config.channels.supportChannelId);
  if (!channel) {
    logger.warn('Supportkanal konnte nicht gefunden werden, der Supportfall wurde aber in der Datenbank gespeichert.');
    return storedCase;
  }

  return ensureSupportCaseMessage(client, runtime, storedCase);
}

async function ensureSupportCaseMessage(client, runtime, supportCase) {
  const channel = await fetchTextChannel(client, runtime.config.channels.supportChannelId, { force: true });
  if (!channel) {
    logger.warn(`Supportfall ${supportCase.case_id}: Supportkanal konnte nicht gefunden werden (falsche ID oder fehlende Berechtigung?).`);
    return supportCase;
  }

  if (supportCase.message_id) {
    const message = await channel.messages.fetch(supportCase.message_id).catch(() => null);
    if (message) {
      return supportCase;
    }
  }

  const payload = buildSupportCaseChannelMessage(supportCase, {
    pingRoleIds: resolveSupportPingRoleIds(runtime)
  });

  const caseId = supportCase.case_id ?? supportCase.caseId;
  let message = await channel.send(payload).catch((error) => {
    logger.warn(`Supportfall ${caseId}: erster Sendeversuch fehlgeschlagen, versuche erneut.`, error?.message ?? error);
    return null;
  });

  if (!message) {
    message = await channel.send(payload).catch((error) => {
      logger.error(`Supportfall ${caseId} konnte auch im zweiten Versuch nicht gesendet werden.`, error);
      return null;
    });
  }

  if (message) {
    runtime.db.updateSupportCaseMessage(runtime.config.guildId, caseId, message.id);
    return {
      ...supportCase,
      case_id: caseId,
      message_id: message.id
    };
  }

  return supportCase;
}

async function syncWaitingRoomSupportCases(client, runtime) {
  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return [];
  }

  const supportArea = runtime.config.duty?.areas?.support ?? {};
  const waitingRoomId = supportArea.waitingChannelId;
  if (!waitingRoomId) {
    return [];
  }

  const waitingRoom = await guild.channels.fetch(waitingRoomId).catch(() => null);
  if (!waitingRoom || !waitingRoom.isVoiceBased?.()) {
    return [];
  }

  const created = [];
  for (const member of waitingRoom.members.values()) {
    const activeCase = runtime.db.getOpenSupportCaseByUser(runtime.config.guildId, member.id);
    if (activeCase) {
      continue;
    }

    const caseRecord = await openSupportCaseForMember(client, runtime, member);
    created.push(caseRecord);
  }

  return created;
}

async function syncExpiredAbsences(client, runtime) {
  const expiredAbsences = runtime.db.getExpiredAbsences(runtime.config.guildId, Date.now());
  if (!expiredAbsences.length) {
    return [];
  }

  const guild = await client.guilds.fetch(runtime.config.guildId).catch(() => null);
  if (!guild) {
    return [];
  }

  const logChannelId = runtime.config.channels.absenceLogChannelId;
  const changed = [];

  for (const absence of expiredAbsences) {
    const member = await guild.members.fetch(absence.user_id).catch(() => null);
    if (member && runtime.config.roles.absenceRoleId) {
      await member.roles.remove(runtime.config.roles.absenceRoleId).catch((error) => {
        logger.warn(`Abmeldungsrolle konnte nicht entfernt werden (${absence.user_id}).`, error?.message ?? error);
      });
    }

    const closed = runtime.db.closeAbsence(runtime.config.guildId, absence.absence_id, 'system', Date.now());
    if (closed) {
      changed.push(absence);
      const finished = runtime.db.getAbsence(absence.absence_id, runtime.config.guildId);
      if (finished) {
        await sendLog(
          client,
          logChannelId,
          'Abmeldung beendet',
          `Die Abmeldung von <@${finished.user_id}> wurde automatisch beendet.`,
          0x2ecc71,
          [
            { name: 'Von', value: new Date(finished.from_at).toLocaleString('de-DE'), inline: true },
            { name: 'Bis', value: new Date(finished.to_at).toLocaleString('de-DE'), inline: true },
            { name: 'Grund', value: finished.reason, inline: false }
          ]
        );
      }
    }
  }

  await refreshActiveAbsencePanel(client, runtime);
  return changed;
}

async function refreshAllPanels(client, runtime) {
  await Promise.allSettled([
    refreshSupportLeaderboardPanel(client, runtime),
    refreshDutyPanel(client, runtime),
    refreshVerifyPanel(client, runtime),
    refreshTeamListPanel(client, runtime),
    refreshTrainerDashboardPanel(client, runtime),
    refreshTrainerAssignmentsPanel(client, runtime),
    refreshFlyPanel(client, runtime),
    refreshAbsencePanel(client, runtime),
    refreshActiveAbsencePanel(client, runtime),
    refreshBewerbungPanel(client, runtime)
  ]);
}

function startMaintenanceLoop(client, runtime) {
  if (runtime.maintenanceTimer) {
    return;
  }

  runtime.maintenanceTimer = setInterval(async () => {
    try {
      await Promise.allSettled([
        syncExpiredAbsences(client, runtime),
        syncWaitingRooms(client, runtime),
        expireBewerbungRejectRoles(client, runtime)
      ]);
    } catch (error) {
      logger.error('Wartungsroutine fehlgeschlagen.', error);
    }
  }, 60_000);

  runtime.panelTimer = setInterval(async () => {
    try {
      await Promise.allSettled([
        refreshSupportLeaderboardPanel(client, runtime),
        refreshTeamListPanel(client, runtime),
        refreshTrainerDashboardPanel(client, runtime),
        refreshTrainerAssignmentsPanel(client, runtime),
        refreshActiveAbsencePanel(client, runtime)
      ]);
    } catch (error) {
      logger.error('Panel-Refresh fehlgeschlagen.', error);
    }
  }, 15 * 60_000);
}

function stopMaintenanceLoop(runtime) {
  if (runtime.maintenanceTimer) {
    clearInterval(runtime.maintenanceTimer);
    runtime.maintenanceTimer = null;
  }

  if (runtime.panelTimer) {
    clearInterval(runtime.panelTimer);
    runtime.panelTimer = null;
  }
}

export {
  refreshAllPanels,
  refreshSupportLeaderboardPanel,
  refreshDutyPanel,
  refreshVerifyPanel,
  refreshTeamListPanel,
  refreshTrainerDashboardPanel,
  refreshTrainerAssignmentsPanel,
  refreshFlyPanel,
  refreshAbsencePanel,
  refreshActiveAbsencePanel,
  syncAutomaticTrainerAssignments,
  syncOpenSupportCases,
  openSupportCaseForMember,
  syncWaitingRoomSupportCases,
  expireStaleSupportCases,
  syncExpiredAbsences,
  startMaintenanceLoop,
  stopMaintenanceLoop
};