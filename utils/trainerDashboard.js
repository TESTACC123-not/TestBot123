import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { formatGermanDateTime, formatRelativeTime } from './time.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

function hasAnyRole(member, roleIds = []) {
  return roleIds.some((roleId) => roleId && member.roles.cache.has(roleId));
}

function truncateLabel(value, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function resolveTrainerAccessRoleIds(config) {
  const labeled = (config.roles.teamRoles ?? [])
    .filter((role) => role?.id && /ausbilder/i.test(role.label ?? ''))
    .map((role) => role.id);

  const explicit = [
    config.roles?.trainerRoleId,
    config.roles?.trainerTargetRoleId
  ].filter(Boolean);

  return [...new Set([...labeled, ...explicit])];
}

export function isTrainerDashboardAllowed(member, runtime) {
  if (!member) {
    return false;
  }

  return Boolean(
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    hasAnyRole(member, resolveTrainerAccessRoleIds(runtime.config))
  );
}

export function resolveTrainerTargetRole(config) {
  const fixedTsupRoleId = config.roles?.trainerTargetRoleId;
  if (fixedTsupRoleId) {
    const fromTeamRoles = (config.roles.teamRoles ?? []).find((role) => role?.id === fixedTsupRoleId);
    return fromTeamRoles ?? { id: fixedTsupRoleId, label: 'T-Sup' };
  }

  return (config.roles.teamRoles ?? []).find((role) => role?.id && /t[- ]?sup/i.test(role.label ?? '')) ?? null;
}

export function resolveTrainerAsbRole(config) {
  const fixedAsbRoleId = config.roles?.trainerRoleId;
  if (!fixedAsbRoleId) {
    return null;
  }

  const fromTeamRoles = (config.roles.teamRoles ?? []).find((role) => role?.id === fixedAsbRoleId);
  return fromTeamRoles ?? { id: fixedAsbRoleId, label: 'ASB' };
}

export function resolveTrainerAsblRole(config) {
  return resolveTrainerAsbRole(config);
}

export async function resolveTeamRoleAssignmentAt(guild, runtime, memberId, roleId, auditLogs = null) {
  const cached = runtime.db.getTeamRoleAssignment(runtime.config.guildId, memberId, roleId);
  if (cached?.assigned_at) {
    return cached.assigned_at;
  }

  const me = guild.members.me ?? null;
  const hasAuditPermission = me?.permissions?.has(PermissionFlagsBits.ViewAuditLog);
  if (!hasAuditPermission) {
    return null;
  }

  const fetchedAuditLogs = auditLogs ?? await guild.fetchAuditLogs({
    type: AuditLogEvent.MemberRoleUpdate,
    limit: 100
  }).catch(() => null);

  if (!fetchedAuditLogs?.entries?.size) {
    return null;
  }

  for (const entry of fetchedAuditLogs.entries.values()) {
    const targetId = entry.target?.id ?? entry.targetId ?? null;
    if (targetId !== memberId) {
      continue;
    }

    const addedChange = entry.changes?.find((change) => change.key === '$add');
    const addedRoles = addedChange?.new ?? addedChange?.new_value ?? [];
    if (!Array.isArray(addedRoles)) {
      continue;
    }

    if (addedRoles.some((role) => role?.id === roleId)) {
      const assignedAt = entry.createdTimestamp ?? null;
      if (assignedAt) {
        runtime.db.upsertTeamRoleAssignment(runtime.config.guildId, memberId, roleId, assignedAt);
      }
      return assignedAt;
    }
  }

  return null;
}

export async function resolveTrainerMembers(guild, runtime) {
  await guild.members.fetch().catch(() => null);

  const targetRole = resolveTrainerTargetRole(runtime.config);
  if (!targetRole) {
    return { targetRole: null, members: [] };
  }

  const members = Array.from(
    guild.members.cache
      .filter((member) => member.roles.cache.has(targetRole.id))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .values()
  );

  const me = guild.members.me ?? null;
  const hasAuditPermission = me?.permissions?.has(PermissionFlagsBits.ViewAuditLog);
  const auditLogs = hasAuditPermission
    ? await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 100
    }).catch(() => null)
    : null;

  const profiles = await Promise.all(members.map(async (member) => {
    const assignedAt = await resolveTeamRoleAssignmentAt(guild, runtime, member.id, targetRole.id, auditLogs);
    const supportStats = runtime.db.getSupportCaseStatsForSupporter(runtime.config.guildId, member.id);
    const trainerAssignment = runtime.db.getTrainerAssignmentByTsup(runtime.config.guildId, member.id);
    const teamSinceText = assignedAt ? `${formatGermanDateTime(assignedAt)} · ${formatRelativeTime(assignedAt)}` : 'Unbekannt';
    const queryAt = assignedAt ? assignedAt + THREE_DAYS_MS : null;
    const maxAt = assignedAt ? assignedAt + FIVE_DAYS_MS : null;
    const voiceChannel = member.voice?.channel ?? null;
    const supportArea = runtime.config.duty?.areas?.support ?? {};
    const supportChannelIds = new Set([
      supportArea.waitingChannelId,
      supportArea.activeChannelId,
      supportArea.finishedChannelId
    ].filter(Boolean));

    return {
      member,
      teamRole: targetRole,
      assignedAt,
      queryAt,
      maxAt,
      teamSinceText,
      supportStats,
      trainerAssignment,
      voiceChannel,
      voiceLabel: voiceChannel ? `<#${voiceChannel.id}>` : 'Nicht im Voice',
      supportCallLabel: voiceChannel && supportChannelIds.has(voiceChannel.id)
        ? `Ja, <#${voiceChannel.id}>`
        : 'Nein'
    };
  }));

  return { targetRole, members: profiles };
}

function buildTrainerDashboardSelectRow(profiles, selectedMemberId = null) {
  if (!profiles.length) {
    return null;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('trainer_dashboard_select')
    .setPlaceholder('T-Sup auswählen')
    .setMinValues(1)
    .setMaxValues(1);

  menu.addOptions(
    profiles.slice(0, 25).map((profile) => ({
      label: truncateLabel(profile.member.displayName, 100),
      value: profile.member.id,
      default: profile.member.id === selectedMemberId
    }))
  );

  return new ActionRowBuilder().addComponents(menu);
}

function buildFooterLine() {
  return `-# Ausbilder-Dashboard | Live-Daten · ${new Date().toLocaleString('de-DE')}`;
}

function buildTrainerOverviewContainer(profileCount) {
  return new ContainerBuilder()
    .setAccentColor(0x16a085)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Ausbilder-Dashboard**'),
      new TextDisplayBuilder().setContent('Wähle unten einen T-Sup aus, um die wichtigsten Infos kompakt zu sehen.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Gefundene T-Sups:** ${profileCount}`,
          '**Abfrage:** Möglich ab 3 Tagen im Team',
          '**Limit:** Spätestens nach 5 Tagen im Team'
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildFooterLine()));
}

function buildTrainerMemberContainer(profile) {
  const { member, teamRole, assignedAt, queryAt, maxAt, teamSinceText, supportStats, trainerAssignment, voiceLabel, supportCallLabel } = profile;
  const totalSupportCases = Number(supportStats?.totalCases ?? 0);
  const closedSupportCases = Number(supportStats?.closedCases ?? 0);
  const activeSupportCases = Number(supportStats?.activeCases ?? 0);
  const assignedAsbLabel = trainerAssignment
    ? `<@${trainerAssignment.asbl_user_id}>`
    : 'Keine ASB zugewiesen';

  const container = new ContainerBuilder()
    .setAccentColor(0x1abc9c)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**T-Sup: ${member.displayName}**`),
      new TextDisplayBuilder().setContent(`Ausgewähltes Mitglied: <@${member.id}>`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Teamrolle:** ${teamRole ? `<@&${teamRole.id}>` : 'Unbekannt'}`,
          `**Im Team seit:** ${teamSinceText}`,
          `**Abfrage möglich ab:** ${assignedAt ? `${formatGermanDateTime(queryAt)} · ${formatRelativeTime(queryAt)}` : 'Unbekannt'}`,
          `**Max im Team bis:** ${assignedAt ? `${formatGermanDateTime(maxAt)} · ${formatRelativeTime(maxAt)}` : 'Unbekannt'}`,
          `**Supportfälle:** ${totalSupportCases} gesamt · ${closedSupportCases} abgeschlossen · ${activeSupportCases} aktiv`,
          `**ASB-Zuordnung:** ${assignedAsbLabel}`,
          `**Aktueller Voice:** ${voiceLabel}`,
          `**Support-Call:** ${supportCallLabel}`
        ].join('\n')
      )
    );

  if (!assignedAt) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Hinweis**\nFür dieses Mitglied wurde noch kein gespeichertes Team-Beitrittsdatum gefunden. Sobald die Rolle neu gesetzt wird, wird das Datum automatisch gespeichert.'
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildFooterLine()));

  return container;
}

export function buildTrainerDashboardPanelPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(0x16a085)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Ausbilder-Dashboard**'),
      new TextDisplayBuilder().setContent('Über den Button unten öffnest du das T-Sup-Dashboard mit einem Auswahlmenü.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '**Inhalt:** T-Sup auswählen, Teamzeit prüfen, Abfrage-Fristen sehen und Support-Status kontrollieren.',
          '**Hinweis:** Die Daten werden live geladen, sobald du das Dropdown öffnest.'
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildFooterLine()))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('trainer_dashboard_open')
          .setLabel('T-Sup Dashboard öffnen')
          .setStyle(ButtonStyle.Primary)
      )
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export async function buildTrainerDashboardPickerPayload(guild, runtime, selectedMemberId = null) {
  const { targetRole, members } = await resolveTrainerMembers(guild, runtime);
  if (!targetRole) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Ausbilder-Dashboard**'),
        new TextDisplayBuilder().setContent('Die T-Sup-Rolle wurde in der config.json nicht gefunden.')
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Ausbilder-Dashboard | Fehler'));

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  if (!members.length) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe67e22)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**Ausbilder-Dashboard**'),
        new TextDisplayBuilder().setContent(`Aktuell hat niemand die Rolle ${targetRole.label}.`)
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          ['**Abfrage möglich ab:** 3 Tage nach Rollenzuweisung', '**Max im Team bis:** 5 Tage nach Rollenzuweisung'].join('\n')
        )
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildFooterLine()));

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const selectedProfile = selectedMemberId
    ? members.find((profile) => profile.member.id === selectedMemberId) ?? null
    : null;

  const container = selectedProfile
    ? buildTrainerMemberContainer(selectedProfile)
    : buildTrainerOverviewContainer(members.length);

  if (!selectedProfile && members.length > 25) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Hinweis**\nIm Dropdown werden aus technischen Gründen nur die ersten 25 T-Sups angezeigt.'
      )
    );
  }

  const row = buildTrainerDashboardSelectRow(members, selectedProfile?.member.id ?? null);
  if (row) {
    container.addActionRowComponents(row);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}