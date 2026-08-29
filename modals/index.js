import { randomUUID } from 'node:crypto';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildFlyRequestPayload, resolveNametagForMember, resolveTeamRoleForMember } from '../utils/renderers.js';
import { refreshActiveAbsencePanel } from '../utils/panels.js';
import { updateIcStatusPanel, computeIcStatus, saveIcState } from '../utils/icCounter.js';
import { autoCheckRpState } from '../utils/serverStatus.js';
import { trackStatusReport, publishStatusLeaderboard } from '../utils/statusLeaderboard.js';
import { logger, sendLog } from '../utils/logger.js';
import { formatGermanDateTime, parseGermanDateTime } from '../utils/time.js';
import { finishBewerbungDecision } from '../utils/bewerbung.js';

function hasAnyRole(member, roleIds = []) {
  return roleIds.some((roleId) => roleId && member.roles.cache.has(roleId));
}

function isAdmin(member) {
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function isStaff(member, runtime) {
  const roleIds = [
    ...runtime.config.support.supporterRoleIds,
    ...runtime.config.roles.supporterRoleIds
  ];

  return isAdmin(member) || hasAnyRole(member, roleIds);
}

function isFlyReviewer(member, runtime) {
  const roleIds = [
    ...runtime.config.roles.flyReviewerRoleIds,
    ...runtime.config.support.supporterRoleIds,
    ...runtime.config.roles.supporterRoleIds
  ];

  return isAdmin(member) || hasAnyRole(member, roleIds);
}

function isTeamMember(member, runtime) {
  return isAdmin(member) || isStaff(member, runtime) || hasAnyRole(member, runtime.config.roles.teamRoles.map((role) => role.id));
}

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }

  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

function normalizeAnswer(input) {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function handleVerifyModal(interaction, runtime) {
  const member = interaction.member;
  const alreadyVerified = runtime.db.isVerified(runtime.config.guildId, interaction.user.id) || (
    runtime.config.roles.citizenRoleId && member.roles.cache.has(runtime.config.roles.citizenRoleId)
  );

  if (alreadyVerified) {
    return replyEphemeral(interaction, 'Du bist bereits verifiziert.');
  }

  const questions = runtime.config.verify.questions.slice(0, 4);
  for (const [index, question] of questions.entries()) {
    const given = interaction.fields.getTextInputValue(`verify_answer_${index + 1}`) ?? '';
    if (!given.trim()) {
      return replyEphemeral(interaction, 'Bitte beantworte alle Verify-Fragen.');
    }

    const expectedAnswers = Array.isArray(question.answers) ? question.answers.filter(Boolean) : [];
    if (expectedAnswers.length > 0) {
      const normalizedGiven = normalizeAnswer(given);
      const normalizedExpected = expectedAnswers.map(normalizeAnswer);
      if (!normalizedExpected.includes(normalizedGiven)) {
        return replyEphemeral(interaction, `Die Antwort auf Frage ${index + 1} ist leider nicht korrekt.`);
      }
    }
  }

  if (!runtime.config.roles.citizenRoleId || !runtime.config.roles.unverifyRoleId) {
    return replyEphemeral(interaction, 'Die Verify-Rollen sind in der config.json nicht korrekt gesetzt.');
  }

  await member.roles.remove(runtime.config.roles.unverifyRoleId).catch((error) => {
    logger.warn('Unverify-Rolle konnte nicht entfernt werden.', error?.message ?? error);
  });
  await member.roles.add(runtime.config.roles.citizenRoleId).catch((error) => {
    logger.warn('Bürger-Rolle konnte nicht vergeben werden.', error?.message ?? error);
  });

  runtime.db.markVerified(runtime.config.guildId, interaction.user.id, interaction.user.id);

  await replyEphemeral(interaction, 'Du wurdest erfolgreich verifiziert. Willkommen!');
}

async function handleFlyModal(interaction, runtime) {
  if (!isTeamMember(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist für diesen Antrag nicht berechtigt.');
  }

  const displayName = interaction.fields.getTextInputValue('fly_display_name')?.trim();

  if (!displayName) {
    return replyEphemeral(interaction, 'Bitte fülle alle Felder vollständig aus.');
  }

  const roblox = runtime.db.getRobloxName(runtime.config.guildId, interaction.user.id);
  if (!roblox?.roblox_name) {
    return replyEphemeral(interaction, 'Es wurde kein Roblox-Name gespeichert.');
  }

  const teamRole = resolveTeamRoleForMember(interaction.member, runtime.config);
  const resolvedNametag = resolveNametagForMember(interaction.member, runtime.config, runtime.nametags, displayName);
  const nametag = resolvedNametag.nametag;

  if (!teamRole || !nametag) {
    return replyEphemeral(interaction, 'Für diesen Antrag ist keine passende Teamrolle oder kein Nametag konfiguriert.');
  }

  const requestId = randomUUID();
  const record = {
    requestId,
    guildId: runtime.config.guildId,
    userId: interaction.user.id,
    displayName,
    reason: '',
    robloxName: roblox.roblox_name,
    teamRoleId: teamRole.id,
    rank: teamRole.label ?? null,
    nametag,
    createdAt: Date.now(),
    status: 'open',
    messageChannelId: runtime.config.fly.requestChannelId || runtime.config.fly.channelId,
    messageId: null
  };

  const targetChannel = await interaction.guild.channels.fetch(runtime.config.fly.requestChannelId || runtime.config.fly.channelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    return replyEphemeral(interaction, 'Der Antrags-Kanal ist nicht korrekt konfiguriert.');
  }

  runtime.db.createFlyRequest(record);
  const message = await targetChannel.send(buildFlyRequestPayload({
    // Ping statt der generischen On-Duty-Rolle: die Teamrolle des Antrags (Rolle für den Anzeigenamen).
    pingRoleId: record.teamRoleId || runtime.config.roles.onDutyRoleId,
    requestRecord: {
      request_id: record.requestId,
      user_id: record.userId,
      display_name: record.displayName,
      reason: record.reason,
      roblox_name: record.robloxName,
      team_role_id: record.teamRoleId,
      rank: record.rank,
      nametag: record.nametag,
      created_at: record.createdAt,
      status: record.status,
      reviewed_at: null,
      reviewer_id: null,
      message_channel_id: record.messageChannelId,
      message_id: null
    }
  })).catch((error) => {
    logger.error('Fly- / Nametag-Antrag konnte nicht gesendet werden.', error);
    return null;
  });

  if (message) {
    runtime.db.updateFlyRequestMessage(runtime.config.guildId, requestId, message.id, targetChannel.id);
    await replyEphemeral(interaction, 'Dein Antrag wurde erfolgreich erstellt.');
  } else {
    await replyEphemeral(interaction, 'Dein Antrag wurde gespeichert, aber der Zielkanal konnte nicht beschrieben werden.');
  }
}

async function handleAbsenceModal(interaction, runtime) {
  if (!isTeamMember(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist für eine Abmeldung nicht berechtigt.');
  }

  const fromRaw = interaction.fields.getTextInputValue('absence_from')?.trim();
  const toRaw = interaction.fields.getTextInputValue('absence_to')?.trim();
  const reason = interaction.fields.getTextInputValue('absence_reason')?.trim();

  if (!fromRaw || !toRaw || !reason) {
    return replyEphemeral(interaction, 'Bitte fülle alle Felder vollständig aus.');
  }

  const fromDate = parseGermanDateTime(fromRaw);
  const toDate = parseGermanDateTime(toRaw);
  if (!fromDate || !toDate) {
    return replyEphemeral(interaction, 'Bitte verwende das Datumsformat TT.MM.JJ HH:MM.');
  }

  if (toDate.getTime() <= fromDate.getTime()) {
    return replyEphemeral(interaction, 'Das Bis-Datum muss nach dem Von-Datum liegen.');
  }

  const activeAbsence = runtime.db.getActiveAbsenceByUser(runtime.config.guildId, interaction.user.id);
  if (activeAbsence) {
    return replyEphemeral(interaction, 'Du hast bereits eine aktive Abmeldung.');
  }

  const absenceId = randomUUID();
  const record = {
    absenceId,
    guildId: runtime.config.guildId,
    userId: interaction.user.id,
    fromAt: fromDate.getTime(),
    toAt: toDate.getTime(),
    reason,
    status: 'active',
    createdAt: Date.now(),
    endedAt: null,
    endedBy: null
  };

  runtime.db.createAbsence(record);

  if (runtime.config.roles.absenceRoleId) {
    await interaction.member.roles.add(runtime.config.roles.absenceRoleId).catch((error) => {
      logger.warn('Abmeldungsrolle konnte nicht vergeben werden.', error?.message ?? error);
    });
  }

  await sendLog(
    interaction.client,
    runtime.config.channels.absenceLogChannelId,
    'Neue Abmeldung',
    `Eine neue Abmeldung von <@${interaction.user.id}> wurde erstellt.`,
    0xe67e22,
    [
      { name: 'Von', value: formatGermanDateTime(record.fromAt), inline: true },
      { name: 'Bis', value: formatGermanDateTime(record.toAt), inline: true },
      { name: 'Grund', value: record.reason, inline: false },
      { name: 'Erstellungszeit', value: formatGermanDateTime(record.createdAt), inline: true }
    ]
  );

  await refreshActiveAbsencePanel(interaction.client, runtime);
  await replyEphemeral(interaction, 'Deine Abmeldung wurde gespeichert und bestätigt.');
}

async function handleIcCounterModal(interaction, runtime) {
  const ic = runtime.config.icCounter || {};
  if (!ic.statusChannelId) {
    return replyEphemeral(interaction, 'Der IC-Counter-Status-Kanal ist in der config.json nicht gesetzt.');
  }

  const raw = interaction.fields.getTextInputValue('ic_player_count')?.trim();
  const cap = Math.max(1, Number(ic.playerCap) || 50);
  const parsed = Number(raw);

  if (!raw || !Number.isInteger(parsed) || parsed < 0) {
    return replyEphemeral(interaction, 'Bitte gib eine gültige ganze Zahl ein (0 oder mehr).');
  }

  const count = Math.min(cap, parsed);
  const state = {
    playerCount: count,
    reportedById: interaction.user.id,
    updatedAt: Date.now()
  };

  saveIcState(runtime.db, runtime.config.guildId, state);

  trackStatusReport(runtime.db, runtime.config.guildId, interaction.user.id);

  const status = computeIcStatus(count, ic);

  const rp = await autoCheckRpState(interaction.client, runtime, count);

  await updateIcStatusPanel(interaction.client, runtime);
  try {
    await publishStatusLeaderboard(interaction.client, runtime);
  } catch (error) {
    logger.warn('Leaderboard konnte nach der Meldung nicht aktualisiert werden.', error?.message ?? error);
  }

  if (rp.changed) {
    return replyEphemeral(
      interaction,
      `Spielerzahl gespeichert: **${count}/${cap}** ${rp.state === 'live' ? '🟢 RP wurde automatisch gestartet.' : '🛑 RP wurde automatisch gestoppt — Status-Updates sind jetzt pausiert.'}`
    );
  }

  await replyEphemeral(
    interaction,
    `Spielerzahl gespeichert: **${count}/${cap}** (${status.emoji} ${status.label}). Der Status wurde aktualisiert.`
  );
}

const handlers = [
  {
    name: 'verify_modal',
    match: (customId) => customId === 'verify_modal',
    execute: (interaction, runtime) => handleVerifyModal(interaction, runtime)
  },
  {
    name: 'fly_modal',
    match: (customId) => customId === 'fly_modal',
    execute: (interaction, runtime) => handleFlyModal(interaction, runtime)
  },
  {
    name: 'absence_modal',
    match: (customId) => customId === 'absence_modal',
    execute: (interaction, runtime) => handleAbsenceModal(interaction, runtime)
  },
  {
    name: 'ic_counter_modal',
    match: (customId) => customId === 'ic_counter_modal',
    execute: (interaction, runtime) => handleIcCounterModal(interaction, runtime)
  },
  {
    name: 'bewerbung_decision_modal',
    match: (customId) => customId.startsWith('bewerbung_decision_modal:'),
    execute: (interaction, runtime) => {
      const [, applicationId, action] = interaction.customId.split(':');
      return finishBewerbungDecision(interaction, runtime, applicationId, action);
    }
  }
];

export default handlers;