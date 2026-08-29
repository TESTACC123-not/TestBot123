import { ActionRowBuilder, ModalBuilder, MessageFlags, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { buildFlyRequestPayload, buildSupportCaseChannelMessage } from '../utils/renderers.js';
import * as trainerDashboard from '../utils/trainerDashboard.js';
import {
  refreshActiveAbsencePanel,
  refreshSupportLeaderboardPanel,
  refreshTeamListPanel
} from '../utils/panels.js';
import { logger } from '../utils/logger.js';
import {
  handleWaitingTake,
  handleWaitingEnd
} from '../utils/waitingRooms.js';
import {
  getDutyAreaLabel,
  getDutyRoleId,
  isOnDuty,
  toggleDutyRole
} from '../utils/duty.js';
import {
  startBewerbung,
  openBewerbungDecisionModal
} from '../utils/bewerbung.js';

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

function buildFlyModal() {
  const modal = new ModalBuilder()
    .setCustomId('fly_modal')
    .setTitle('Fly- / Nametag-Antrag');

  const displayName = new TextInputBuilder()
    .setCustomId('fly_display_name')
    .setLabel('Anzeigename')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Wie soll der Name angezeigt werden?');

  const reason = new TextInputBuilder()
    .setCustomId('fly_reason')
    .setLabel('Begründung')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(700)
    .setPlaceholder('Warum wird der Antrag benötigt?');

  modal.addComponents(
    new ActionRowBuilder().addComponents(displayName),
    new ActionRowBuilder().addComponents(reason)
  );

  return modal;
}

function buildAbsenceModal() {
  const modal = new ModalBuilder()
    .setCustomId('absence_modal')
    .setTitle('Abmeldung erstellen');

  const from = new TextInputBuilder()
    .setCustomId('absence_from')
    .setLabel('Von (TT.MM.JJ HH:MM)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('04.08.26 18:00');

  const to = new TextInputBuilder()
    .setCustomId('absence_to')
    .setLabel('Bis (TT.MM.JJ HH:MM)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('05.08.26 20:00');

  const reason = new TextInputBuilder()
    .setCustomId('absence_reason')
    .setLabel('Grund')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(700)
    .setPlaceholder('Warum meldest du dich ab?');

  modal.addComponents(
    new ActionRowBuilder().addComponents(from),
    new ActionRowBuilder().addComponents(to),
    new ActionRowBuilder().addComponents(reason)
  );

  return modal;
}

function buildIcCounterModal(config = {}) {
  const cap = Math.max(1, Number(config.playerCap) || 50);
  const modal = new ModalBuilder()
    .setCustomId('ic_counter_modal')
    .setTitle('Spielerzahl melden');

  const playerCount = new TextInputBuilder()
    .setCustomId('ic_player_count')
    .setLabel(`Aktuelle Spielerzahl IC (0-${cap})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3)
    .setPlaceholder('z.B. 23');

  modal.addComponents(
    new ActionRowBuilder().addComponents(playerCount)
  );

  return modal;
}

async function handleSupportTake(interaction, runtime, caseId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member, runtime) && !isOnDuty(interaction.member, runtime, 'support')) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Supportfälle zu übernehmen.');
  }

  const supportCase = runtime.db.getSupportCase(caseId, runtime.config.guildId);
  if (!supportCase || supportCase.status !== 'open') {
    return replyEphemeral(interaction, 'Dieser Supportfall wurde bereits übernommen oder geschlossen.');
  }

  const claimed = runtime.db.claimSupportCase(runtime.config.guildId, caseId, interaction.user.id);
  if (!claimed) {
    return replyEphemeral(interaction, 'Der Supportfall wurde in der Zwischenzeit bereits übernommen.');
  }

  const updatedCase = runtime.db.getSupportCase(caseId, runtime.config.guildId);
  const channel = await interaction.guild.channels.fetch(updatedCase.support_channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    const message = updatedCase.message_id
      ? await channel.messages.fetch(updatedCase.message_id).catch(() => null)
      : null;
    const payload = buildSupportCaseChannelMessage(updatedCase);

    if (message) {
      await message.edit(payload).catch((error) => {
        logger.warn(`Supportfall ${caseId} konnte nach Übernahme nicht aktualisiert werden.`, error?.message ?? error);
      });
    } else {
      const sent = await channel.send(payload).catch((error) => {
        logger.error(`Supportfall ${caseId} konnte nach Übernahme nicht neu gesendet werden.`, error);
        return null;
      });
      if (sent) {
        runtime.db.updateSupportCaseMessage(runtime.config.guildId, caseId, sent.id);
      }
    }
  }

  // Beim Übernehmen wird der Hilfesuchende in den Voice-Channel des Supporters
  // verschoben – und zwar nur dorthin, wo der Supporter gerade selbst sitzt.
  // Separate „angenommen“/„beenden“-Voice-Räume werden dafür nicht gebraucht.
  const targetVoiceChannelId = interaction.member?.voice?.channelId || '';
  if (targetVoiceChannelId) {
    const member = await interaction.guild.members.fetch(updatedCase.user_id).catch(() => null);
    if (member?.voice?.channelId) {
      await member.voice.setChannel(targetVoiceChannelId).catch((error) => {
        logger.warn(`Supportfall ${caseId}: Benutzer konnte nicht in den Voice-Channel des Supporters verschoben werden.`, error?.message ?? error);
      });
    }
  }

  await interaction.editReply({ content: 'Der Supportfall wurde erfolgreich übernommen.' });
}

async function handleSupportEnd(interaction, runtime, caseId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const supportCase = runtime.db.getSupportCase(caseId, runtime.config.guildId);
  if (!supportCase || supportCase.status !== 'taken') {
    return replyEphemeral(interaction, 'Dieser Supportfall ist bereits geschlossen oder wurde noch nicht übernommen.');
  }

  const allowed = supportCase.supporter_id === interaction.user.id;
  if (!allowed) {
    return replyEphemeral(interaction, 'Nur der zuständige Supporter kann diesen Fall beenden.');
  }

  const endedAt = Date.now();
  const closed = runtime.db.closeSupportCase(runtime.config.guildId, caseId, interaction.user.id, endedAt);
  if (!closed) {
    return replyEphemeral(interaction, 'Der Supportfall konnte nicht geschlossen werden.');
  }

  const updatedCase = runtime.db.getSupportCase(caseId, runtime.config.guildId);
  const member = await interaction.guild.members.fetch(updatedCase.user_id).catch(() => null);
  if (member?.voice?.channelId) {
    await member.voice.setChannel(null).catch((error) => {
      logger.warn(`Supportfall ${caseId}: Benutzer konnte nicht aus dem Call getrennt werden.`, error?.message ?? error);
    });
  }

  const channel = await interaction.guild.channels.fetch(updatedCase.support_channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    const message = updatedCase.message_id
      ? await channel.messages.fetch(updatedCase.message_id).catch(() => null)
      : null;
    const payload = buildSupportCaseChannelMessage(updatedCase);

    if (message) {
      await message.edit(payload).catch((error) => {
        logger.warn(`Supportfall ${caseId} konnte nach Abschluss nicht aktualisiert werden.`, error?.message ?? error);
      });
    } else {
      const sent = await channel.send(payload).catch((error) => {
        logger.error(`Supportfall ${caseId} konnte nach Abschluss nicht neu gesendet werden.`, error);
        return null;
      });
      if (sent) {
        runtime.db.updateSupportCaseMessage(runtime.config.guildId, caseId, sent.id);
      }
    }
  }

  const handledSeconds = Math.max(0, Math.floor((updatedCase.ended_at - (updatedCase.taken_at ?? updatedCase.created_at)) / 1000));
  await refreshSupportLeaderboardPanel(interaction.client, runtime);
  await interaction.editReply({ content: 'Der Supportfall wurde geschlossen und der Benutzer wurde aus dem Call getrennt.' });
}

async function handleTrainerDashboardOpen(interaction, runtime) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!trainerDashboard.isTrainerDashboardAllowed(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, das Ausbilder-Dashboard zu nutzen.');
  }

  const buildTrainerDashboardPickerPayload =
    trainerDashboard.buildTrainerDashboardPickerPayload ??
    (async () => trainerDashboard.buildTrainerDashboardPanelPayload?.() ?? {
      content: 'Das Ausbilder-Dashboard konnte nicht geladen werden.'
    });

  const payload = await buildTrainerDashboardPickerPayload(interaction.guild, runtime);
  await interaction.editReply(payload).catch((error) => {
    logger.warn('Ausbilder-Dashboard konnte nicht geöffnet werden.', error?.message ?? error);
  });
}

async function handleDutyToggle(interaction, runtime, area, dutyOn) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.member) && !isStaff(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, deinen Dienststatus zu ändern.');
  }

  const roleId = getDutyRoleId(runtime, area);
  if (!roleId) {
    return replyEphemeral(
      interaction,
      `Für den Bereich „${getDutyAreaLabel(runtime, area)}“ ist in der config.json (duty.areas.${area}.roleId) keine Rolle gesetzt.`
    );
  }

  const hasRole = interaction.member.roles.cache.has(roleId);
  if (dutyOn && hasRole) {
    return replyEphemeral(interaction, `Du bist im Bereich „${getDutyAreaLabel(runtime, area)}“ bereits On Duty.`);
  }

  if (!dutyOn && !hasRole) {
    return replyEphemeral(interaction, `Du bist im Bereich „${getDutyAreaLabel(runtime, area)}“ bereits Off Duty.`);
  }

  const result = await toggleDutyRole(interaction.member, runtime, area, dutyOn);
  if (!result.ok) {
    logger.warn(`Duty-Rolle konnte nicht umgeschaltet werden (${area}).`, result.error?.message ?? result.error);
    return replyEphemeral(
      interaction,
      `Die Dienstrolle für „${getDutyAreaLabel(runtime, area)}“ konnte nicht ${dutyOn ? 'vergeben' : 'entfernt'} werden. Prüfe die Bot-Berechtigungen.`
    );
  }

  return interaction.editReply({
    content: dutyOn
      ? `Du bist jetzt im Bereich „${getDutyAreaLabel(runtime, area)}“ **On Duty**.`
      : `Du bist jetzt im Bereich „${getDutyAreaLabel(runtime, area)}“ **Off Duty**.`
  });
}

async function handleVerifyStart(interaction, runtime) {
  const verified = runtime.db.isVerified(runtime.config.guildId, interaction.user.id) || (
    runtime.config.roles.citizenRoleId && interaction.member.roles.cache.has(runtime.config.roles.citizenRoleId)
  );

  if (verified) {
    return replyEphemeral(interaction, 'Du bist bereits verifiziert.');
  }

  if (!runtime.config.roles.citizenRoleId || !runtime.config.roles.unverifyRoleId) {
    return replyEphemeral(interaction, 'Die Verify-Rollen sind in der config.json nicht korrekt gesetzt.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await interaction.member.roles.remove(runtime.config.roles.unverifyRoleId).catch((error) => {
    logger.warn('Unverify-Rolle konnte nicht entfernt werden.', error?.message ?? error);
  });
  await interaction.member.roles.add(runtime.config.roles.citizenRoleId).catch((error) => {
    logger.warn('Bürger-Rolle konnte nicht vergeben werden.', error?.message ?? error);
  });

  runtime.db.markVerified(runtime.config.guildId, interaction.user.id, interaction.user.id);

  await interaction.editReply({ content: 'Du wurdest erfolgreich verifiziert. Willkommen!' });
}

async function handleFlyCreate(interaction, runtime) {
  const roblox = runtime.db.getRobloxName(runtime.config.guildId, interaction.user.id);
  if (!roblox?.roblox_name) {
    return replyEphemeral(interaction, 'Bitte trage zuerst deinen Roblox-Name im Teamlisten-Kanal ein.');
  }

  const member = interaction.member;
  const teamRole = runtime.config.roles.teamRoles.find((role) => role.id && member.roles.cache.has(role.id));
  if (!teamRole) {
    return replyEphemeral(interaction, 'Für diesen Antrag muss mindestens eine konfigurierte Teamrolle vorhanden sein.');
  }

  await interaction.showModal(buildFlyModal());
}

async function handleFlyReviewed(interaction, runtime, requestId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isFlyReviewer(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Fly- / Nametag-Anträge zu bearbeiten.');
  }

  const request = runtime.db.getFlyRequest(requestId, runtime.config.guildId);
  if (!request || request.status !== 'open') {
    return replyEphemeral(interaction, 'Dieser Antrag wurde bereits bearbeitet oder existiert nicht mehr.');
  }

  const reviewed = runtime.db.reviewFlyRequest(runtime.config.guildId, requestId, interaction.user.id);
  if (!reviewed) {
    return replyEphemeral(interaction, 'Der Antrag wurde in der Zwischenzeit bereits bearbeitet.');
  }

  const updated = runtime.db.getFlyRequest(requestId, runtime.config.guildId);
  const sourceChannel = await interaction.guild.channels.fetch(updated.message_channel_id || runtime.config.fly.channelId).catch(() => null);
  // Bearbeitete Anträge werden in den speziellen Done-Kanal verschoben.
  const doneChannel = runtime.config.fly.doneChannelId
    ? await interaction.guild.channels.fetch(runtime.config.fly.doneChannelId).catch(() => null)
    : null;

  const payload = buildFlyRequestPayload({
    // Ping statt der generischen On-Duty-Rolle: die Teamrolle des Antrags (Rolle für den Anzeigenamen).
    pingRoleId: updated.team_role_id || runtime.config.roles.onDutyRoleId,
    requestRecord: updated,
    reviewerName: `<@${interaction.user.id}>`,
    reviewedAt: updated.reviewed_at,
    processingDuration: updated.reviewed_at - updated.created_at
  });

  if (doneChannel?.isTextBased()) {
    const sent = await doneChannel.send(payload).catch((error) => {
      logger.error(`Fly-Antrag ${requestId} konnte nicht in den Done-Kanal gesendet werden.`, error);
      return null;
    });
    if (sent) {
      runtime.db.updateFlyRequestMessage(runtime.config.guildId, requestId, sent.id, doneChannel.id);
      // Ursprüngliche Nachricht im Antrags-Kanal entfernen.
      if (updated.message_id && sourceChannel?.isTextBased()) {
        const original = await sourceChannel.messages.fetch(updated.message_id).catch(() => null);
        if (original) {
          await original.delete().catch(() => null);
        }
      }
    }
  } else if (sourceChannel?.isTextBased()) {
    // Kein Done-Kanal konfiguriert: im Antrags-Kanal aktualisieren (bisheriges Verhalten).
    const message = updated.message_id
      ? await sourceChannel.messages.fetch(updated.message_id).catch(() => null)
      : null;
    if (message) {
      await message.edit(payload).catch((error) => {
        logger.warn(`Fly-Antrag ${requestId} konnte nicht aktualisiert werden.`, error?.message ?? error);
      });
    } else {
      const sent = await sourceChannel.send(payload).catch((error) => {
        logger.error(`Fly-Antrag ${requestId} konnte nicht neu gesendet werden.`, error);
        return null;
      });
      if (sent) {
        runtime.db.updateFlyRequestMessage(runtime.config.guildId, requestId, sent.id, sourceChannel.id);
      }
    }
  }

  await interaction.editReply({ content: 'Der Antrag wurde als bearbeitet markiert.' });
}

async function handleAbsenceOpen(interaction, runtime) {
  const activeAbsence = runtime.db.getActiveAbsenceByUser(runtime.config.guildId, interaction.user.id);
  if (activeAbsence) {
    return replyEphemeral(interaction, 'Du hast bereits eine aktive Abmeldung.');
  }

  const isAllowed = isTeamMember(interaction.member, runtime);
  if (!isAllowed) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, eine Abmeldung zu erstellen.');
  }

  await interaction.showModal(buildAbsenceModal());
}

async function handleIcCounterOpen(interaction, runtime) {
  const ic = runtime.config.icCounter || {};
  if (!ic.messageChannelId || !ic.statusChannelId) {
    return replyEphemeral(interaction, 'Der IC-Counter ist in der config.json noch nicht konfiguriert.');
  }

  await interaction.showModal(buildIcCounterModal(ic));
}

async function handleServerPushRoleToggle(interaction, runtime) {
  const ss = runtime.config.serverStatus || {};
  const roleId = ss.statusRoleId;
  if (!roleId) {
    return replyEphemeral(interaction, 'Die Status-Rolle (serverStatus.statusRoleId) ist in der config.json nicht gesetzt.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = interaction.member;
  const has = member.roles.cache.has(roleId);
  try {
    if (has) {
      await member.roles.remove(roleId);
      await interaction.editReply({ content: '✅ Status-Rolle wurde **entfernt** — du erhältst keine Status-Pings mehr.' });
    } else {
      await member.roles.add(roleId);
      await interaction.editReply({ content: '✅ Status-Rolle wurde **hinzugefügt** — du erhältst ab jetzt Status-Pings.' });
    }
  } catch (error) {
    logger.warn('Status-Rolle konnte nicht umgeschaltet werden.', error?.message ?? error);
    await interaction.editReply({ content: '❌ Status-Rolle konnte nicht umgeschaltet werden. Prüfe die Bot-Berechtigungen.' }).catch(() => null);
  }
}

const handlers = [
  {
    name: 'support_take',
    match: (customId) => customId.startsWith('support_take:'),
    execute: (interaction, runtime) => handleSupportTake(interaction, runtime, interaction.customId.split(':')[1])
  },
  {
    name: 'support_end',
    match: (customId) => customId.startsWith('support_end:'),
    execute: (interaction, runtime) => handleSupportEnd(interaction, runtime, interaction.customId.split(':')[1])
  },
  {
    name: 'waiting_take',
    match: (customId) => customId.startsWith('waiting_take:'),
    execute: (interaction, runtime) => {
      const [, type, requestId] = interaction.customId.split(':');
      return handleWaitingTake(interaction, runtime, type, requestId);
    }
  },
  {
    name: 'waiting_end',
    match: (customId) => customId.startsWith('waiting_end:'),
    execute: (interaction, runtime) => {
      const [, type, requestId] = interaction.customId.split(':');
      return handleWaitingEnd(interaction, runtime, type, requestId);
    }
  },
  {
    name: 'trainer_dashboard_open',
    match: (customId) =>
      customId === 'trainer_dashboard_open' ||
      customId === 'ausbilder_dashboard_open' ||
      customId.startsWith('trainer_dashboard') ||
      customId.startsWith('ausbilder_dashboard'),
    execute: (interaction, runtime) => handleTrainerDashboardOpen(interaction, runtime)
  },
  {
    name: 'duty_on',
    match: (customId) => customId === 'duty_on',
    execute: (interaction, runtime) => handleDutyToggle(interaction, runtime, 'support', true)
  },
  {
    name: 'duty_off',
    match: (customId) => customId === 'duty_off',
    execute: (interaction, runtime) => handleDutyToggle(interaction, runtime, 'support', false)
  },
  {
    name: 'duty_on_area',
    match: (customId) => customId.startsWith('duty_on:'),
    execute: (interaction, runtime) => handleDutyToggle(interaction, runtime, interaction.customId.split(':')[1], true)
  },
  {
    name: 'duty_off_area',
    match: (customId) => customId.startsWith('duty_off:'),
    execute: (interaction, runtime) => handleDutyToggle(interaction, runtime, interaction.customId.split(':')[1], false)
  },
  {
    name: 'verify_start',
    match: (customId) => customId === 'verify_start',
    execute: (interaction, runtime) => handleVerifyStart(interaction, runtime)
  },
  {
    name: 'fly_create',
    match: (customId) => customId === 'fly_create',
    execute: (interaction, runtime) => handleFlyCreate(interaction, runtime)
  },
  {
    name: 'fly_reviewed',
    match: (customId) => customId.startsWith('fly_reviewed:'),
    execute: (interaction, runtime) => handleFlyReviewed(interaction, runtime, interaction.customId.split(':')[1])
  },
  {
    name: 'absence_open',
    match: (customId) => customId === 'absence_open',
    execute: (interaction, runtime) => handleAbsenceOpen(interaction, runtime)
  },
  {
    name: 'ic_counter_report',
    match: (customId) => customId === 'ic_counter_report',
    execute: (interaction, runtime) => handleIcCounterOpen(interaction, runtime)
  },
  {
    name: 'serverpush_role_toggle',
    match: (customId) => customId === 'serverpush_role_toggle',
    execute: (interaction, runtime) => handleServerPushRoleToggle(interaction, runtime)
  },
  {
    name: 'bewerbung_start',
    match: (customId) => customId === 'bewerbung_start',
    execute: (interaction, runtime) => startBewerbung(interaction, runtime)
  },
  {
    name: 'bewerbung_accept',
    match: (customId) => customId.startsWith('bewerbung_accept:'),
    execute: (interaction, runtime) =>
      openBewerbungDecisionModal(interaction, runtime, interaction.customId.split(':')[1], 'accept')
  },
  {
    name: 'bewerbung_reject',
    match: (customId) => customId.startsWith('bewerbung_reject:'),
    execute: (interaction, runtime) =>
      openBewerbungDecisionModal(interaction, runtime, interaction.customId.split(':')[1], 'reject')
  }
];

export default handlers;