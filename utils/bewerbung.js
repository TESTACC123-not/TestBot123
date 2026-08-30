import { randomUUID } from 'node:crypto';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  buildBewerbungCancelledPayload,
  buildBewerbungDecisionDmPayload,
  buildBewerbungDmQuestion,
  buildBewerbungPanelPayload,
  buildBewerbungResultPayload,
  buildBewerbungSubmittedPayload
} from './bewerbungRenderer.js';
import { logger, sendLog } from './logger.js';

/* ============================================================
 * PERMISSIONS
 * ============================================================ */

function hasAnyRole(member, roleIds = []) {
  return roleIds.some((roleId) => roleId && member.roles.cache.has(roleId));
}

export function isAdmin(member) {
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

export function isBewerbungReviewer(member, runtime) {
  const roleIds = runtime.config.bewerbung?.reviewerRoleIds ?? [];
  return isAdmin(member) || hasAnyRole(member, roleIds);
}

function isConfigured(runtime) {
  const cfg = runtime.config.bewerbung;
  return Boolean(
    cfg?.panelChannelId &&
    cfg?.resultChannelId &&
    Array.isArray(cfg?.questions) &&
    cfg.questions.length > 0
  );
}

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function tryOpenDm(user) {
  try {
    return await user.createDM();
  } catch (error) {
    logger.warn('DM-Kanal konnte nicht geöffnet werden.', error?.message ?? error);
    return null;
  }
}

/* ============================================================
 * PANEL
 * ============================================================ */

function isValidChannelId(id) {
  return typeof id === 'string' && /^\d{10,25}$/.test(id);
}

export async function refreshBewerbungPanel(client, runtime) {
  const { panels } = runtime.config;
  const channelId = panels.bewerbung?.channelId || runtime.config.bewerbung?.panelChannelId;
  if (!channelId) {
    logger.warn(
      'Bewerbungs-Panel wird nicht gepostet: Kein Kanal konfiguriert. Setze in der config.json `bewerbung.panelChannelId` (oder `panels.bewerbung.channelId`) auf die Kanal-ID des Kanals mit dem "Bewerben"-Button.'
    );
    return null;
  }

  if (!isValidChannelId(channelId)) {
    logger.warn(
      `Bewerbungs-Panel wird nicht gepostet: Die Kanal-ID "${channelId}" ist kein gültiger Discord-Kanal. Trage in der config.json unter \`bewerbung.panelChannelId\` eine echte Kanal-ID ein (nur Ziffern).`
    );
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
    logger.warn(
      `Bewerbungs-Panel wird nicht gepostet: Der Kanal ${channelId} konnte nicht gefunden werden. Prüfe, ob \`bewerbung.panelChannelId\` die richtige Kanal-ID ist.`
    );
    return null;
  }

  const stored = runtime.db.getPanelMessage('bewerbung');
  const candidateMessageId = stored?.message_id || panels.bewerbung?.messageId;
  const payload = buildBewerbungPanelPayload();

  if (candidateMessageId) {
    const message = await channel.messages.fetch(candidateMessageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      runtime.db.upsertPanelMessage('bewerbung', runtime.config.guildId, channel.id, message.id);
      return message;
    }
  }

  try {
    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage('bewerbung', runtime.config.guildId, channel.id, sent.id);
    logger.info('Bewerbungs-Panel wurde gepostet/aktualisiert.');
    return sent;
  } catch (error) {
    logger.error('Bewerbungs-Panel konnte nicht gesendet werden.', error);
    return null;
  }
}

/* ============================================================
 * DM-FLOW START (Button)
 * ============================================================ */

export async function startBewerbung(interaction, runtime) {
  if (!isConfigured(runtime)) {
    return replyEphemeral(interaction, 'Das Bewerbungssystem ist noch nicht vollständig konfiguriert.');
  }

  const session = runtime.db.getBewerbungSession(runtime.config.guildId, interaction.user.id);
  if (session) {
    return replyEphemeral(
      interaction,
      'Du hast bereits eine laufende Bewerbung. Bitte beantworte die Fragen weiter in deiner Direktnachricht.'
    );
  }

  const open = runtime.db.getOpenBewerbungByUser(runtime.config.guildId, interaction.user.id);
  if (open) {
    return replyEphemeral(
      interaction,
      'Du hast bereits eine offene Bewerbung. Diese muss erst bearbeitet werden, bevor du dich erneut bewerben kannst.'
    );
  }

  const dm = await tryOpenDm(interaction.user);
  if (!dm) {
    return replyEphemeral(
      interaction,
      'Ich konnte dir keine Direktnachricht schicken. Bitte erlaube Direktnachrichten von Server-Mitgliedern und versuche es erneut.'
    );
  }

  const questions = runtime.config.bewerbung.questions;
  runtime.db.upsertBewerbungSession(runtime.config.guildId, interaction.user.id, {
    currentIndex: 0,
    answers: []
  });

  await dm.send(buildBewerbungDmQuestion(questions[0], 0, questions.length)).catch((error) => {
    logger.error('Erste Bewerbungsfrage konnte nicht gesendet werden.', error);
  });

  return replyEphemeral(
    interaction,
    'Deine Bewerbung wurde gestartet! Die Fragen kommen per Direktnachricht – bitte beantworte sie dort nacheinander.'
  );
}

/* ============================================================
 * DM-ANTWORT (messageCreate)
 * ============================================================ */

export async function handleBewerbungDmMessage(message, runtime) {
  const session = runtime.db.getBewerbungSessionByUser(message.author.id);
  if (!session) return false;

  const questions = runtime.config.bewerbung.questions;
  if (!questions.length) return false;

  const answer = message.content?.trim();
  if (!answer) {
    await message.reply('Bitte gib eine Antwort über Text ein.').catch(() => null);
    return true;
  }

  const answers = session.answers;
  if (answers[session.currentIndex] === undefined) {
    answers.push(answer);
  } else {
    answers[session.currentIndex] = answer;
  }

  const nextIndex = session.currentIndex + 1;
  if (nextIndex < questions.length) {
    runtime.db.upsertBewerbungSession(session.guildId, message.author.id, {
      currentIndex: nextIndex,
      answers
    });
    await message.channel
      .send(buildBewerbungDmQuestion(questions[nextIndex], nextIndex, questions.length))
      .catch(() => null);
    return true;
  }

  // Alle Fragen beantwortet → Bewerbung abschließen.
  runtime.db.deleteBewerbungSession(session.guildId, message.author.id);
  await finalizeBewerbung(message.client, runtime, message.author.id, answers, session.guildId);
  return true;
}

/* ============================================================
 * BEWERBUNG ABBRECHEN (Button im Fragen-DM)
 * ============================================================ */

export async function cancelBewerbung(interaction, runtime) {
  const userId = interaction.user.id;
  const session = runtime.db.getBewerbungSessionByUser(userId);

  if (!session) {
    return replyEphemeral(interaction, 'Du hast aktuell keine laufende Bewerbung, die abgebrochen werden kann.');
  }

  runtime.db.deleteBewerbungSession(session.guildId, userId);

  // Den Abbrechen-Button auf der aktuellen Frage deaktivieren.
  if (interaction.message?.id) {
    interaction.message.edit({ components: [] }).catch(() => null);
  }

  // Bestätigung als Embed in die DM senden.
  try {
    const dm = await interaction.user.createDM().catch(() => null);
    if (dm) {
      await dm.send(buildBewerbungCancelledPayload()).catch(() => null);
    }
  } catch (error) {
    logger.warn(`Abbruch-Bestätigung an ${userId} fehlgeschlagen.`, error?.message ?? error);
  }

  return replyEphemeral(interaction, 'Deine Bewerbung wurde **abgebrochen** und verworfen.');
}

async function finalizeBewerbung(client, runtime, userId, answers, guildId) {
  const applicationId = randomUUID();
  const createdAt = Date.now();
  const record = {
    applicationId,
    guildId: guildId || runtime.config.guildId,
    userId,
    answers,
    status: 'open',
    createdAt,
    reviewedAt: null,
    reviewerId: null,
    reviewReason: null,
    messageChannelId: runtime.config.bewerbung.resultChannelId,
    messageId: null,
    rejectRoleRemovedAt: null
  };

  runtime.db.createBewerbung(record);

  const channel = await client.channels.fetch(runtime.config.bewerbung.resultChannelId).catch(() => null);
  const pingRoleId = runtime.config.bewerbung.pingRoleId;
  if (!channel?.isTextBased?.()) {
    await sendLog(client, runtime.config.channels.absenceLogChannelId, 'Bewerbung', `Bewerbung von <@${userId}> konnte nicht gepostet werden (Ergebnis-Kanal fehlt).`, 0xe74c3c);
    return;
  }

  const payload = buildBewerbungResultPayload({
    record,
    questions: runtime.config.bewerbung.questions,
    pingRoleId
  });
  const sent = await channel.send({
    ...payload,
    allowedMentions: pingRoleId
      ? { parse: [], roles: [pingRoleId], users: [] }
      : { parse: [] }
  }).catch((error) => {
    logger.error('Bewerbung konnte nicht gepostet werden.', error);
    return null;
  });

  if (sent) {
    runtime.db.updateBewerbungMessage(runtime.config.guildId, applicationId, sent.id, channel.id);
  }

  // Bestätigung an den Bewerber: Bewerbung wurde erfolgreich abgesendet.
  try {
    const applicant = await client.users.fetch(userId).catch(() => null);
    if (applicant) {
      const dm = await applicant.createDM().catch(() => null);
      if (dm) {
        await dm.send(buildBewerbungSubmittedPayload()).catch((error) => {
          logger.warn('Bewerbungs-Bestätigung konnte nicht per DM gesendet werden.', error?.message ?? error);
        });
      }
    }
  } catch (error) {
    logger.warn(`Bewerbungs-Bestätigung an ${userId} fehlgeschlagen.`, error?.message ?? error);
  }
}

/* ============================================================
 * ANNEHMEN / ABLEHNEN (Buttons → Modal)
 * ============================================================ */

export async function openBewerbungDecisionModal(interaction, runtime, applicationId, action) {
  if (!isBewerbungReviewer(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Bewerbungen zu bearbeiten.');
  }

  const record = runtime.db.getBewerbung(applicationId, runtime.config.guildId);
  if (!record || record.status !== 'open') {
    return replyEphemeral(interaction, 'Diese Bewerbung wurde bereits bearbeitet oder existiert nicht mehr.');
  }

  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
  const modal = new ModalBuilder()
    .setCustomId(`bewerbung_decision_modal:${applicationId}:${action}`)
    .setTitle(action === 'accept' ? 'Bewerbung annehmen' : 'Bewerbung ablehnen');

  const reason = new TextInputBuilder()
    .setCustomId('bewerbung_reason')
    .setLabel('Grund / Nachricht an den Bewerber')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder(action === 'accept' ? 'Warum wird der Bewerber angenommen?' : 'Warum wird die Bewerbung abgelehnt?');

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal);
}

/* ============================================================
 * MODAL-SUBMIT (Entscheidung abschließen)
 * ============================================================ */

export async function finishBewerbungDecision(interaction, runtime, applicationId, action) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isBewerbungReviewer(interaction.member, runtime)) {
    return replyEphemeral(interaction, 'Du bist nicht berechtigt, Bewerbungen zu bearbeiten.');
  }

  const record = runtime.db.getBewerbung(applicationId, runtime.config.guildId);
  if (!record || record.status !== 'open') {
    return replyEphemeral(interaction, 'Diese Bewerbung wurde bereits bearbeitet oder existiert nicht mehr.');
  }

  const reason = interaction.fields.getTextInputValue('bewerbung_reason')?.trim() || '';
  if (!reason) {
    return replyEphemeral(interaction, 'Bitte gib einen Grund ein.');
  }

  const status = action === 'accept' ? 'accepted' : 'rejected';
  const updated = runtime.db.reviewBewerbung(runtime.config.guildId, applicationId, {
    status,
    reviewerId: interaction.user.id,
    reviewReason: reason
  });
  if (!updated) {
    return replyEphemeral(interaction, 'Die Bewerbung wurde in der Zwischenzeit bereits bearbeitet.');
  }

  const freshRecord = runtime.db.getBewerbung(applicationId, runtime.config.guildId);

  // Nachricht im Ergebnis-Kanal aktualisieren.
  const channel = await interaction.guild.channels
    .fetch(freshRecord.message_channel_id || runtime.config.bewerbung.resultChannelId)
    .catch(() => null);
  if (channel?.isTextBased?.()) {
    const message = freshRecord.message_id
      ? await channel.messages.fetch(freshRecord.message_id).catch(() => null)
      : null;
    const payload = buildBewerbungResultPayload({
      record: freshRecord,
      questions: runtime.config.bewerbung.questions,
      reviewerName: `<@${interaction.user.id}>`
    });
    if (message) {
      await message.edit(payload).catch(() => null);
    }
  }

  // Rolle vergeben.
  const member = await interaction.guild.members.fetch(freshRecord.user_id).catch(() => null);
  const roleId = status === 'accepted'
    ? runtime.config.bewerbung.acceptRoleId
    : runtime.config.bewerbung.rejectRoleId;

  if (member && roleId) {
    await member.roles.add(roleId).catch((error) => {
      logger.warn(`Bewerbung ${applicationId}: Rolle ${roleId} konnte nicht vergeben werden.`, error?.message ?? error);
    });
  }

  // Den Bewerber per DM benachrichtigen (als Embed).
  try {
    const applicant = await interaction.client.users.fetch(freshRecord.user_id).catch(() => null);
    if (applicant) {
      const dm = await applicant.createDM().catch(() => null);
      if (dm) {
        await dm.send(
          buildBewerbungDecisionDmPayload({
            status,
            reason,
            rejectDurationHours: runtime.config.bewerbung.rejectDurationHours
          })
        ).catch(() => null);
      }
    }
  } catch (error) {
    logger.warn(`Bewerber ${freshRecord.user_id} konnte nicht per DM benachrichtigt werden.`, error?.message ?? error);
  }

  return replyEphemeral(
    interaction,
    status === 'accepted'
      ? 'Bewerbung wurde **angenommen** und die Rolle vergeben.'
      : `Bewerbung wurde **abgelehnt**. Die Ablehnungs-Rolle wird nach ${runtime.config.bewerbung.rejectDurationHours} Stunden entfernt.`
  );
}

/* ============================================================
 * 48H-ROLLEN-AUFRAUM
 * ============================================================ */

export async function expireBewerbungRejectRoles(client, runtime) {
  const roleId = runtime.config.bewerbung?.rejectRoleId;
  const durationHours = runtime.config.bewerbung?.rejectDurationHours ?? 48;
  const guildId = runtime.config.guildId;
  if (!roleId) return;

  const pending = runtime.db.getRejectedBewerbungenPendingRemoval(guildId);
  if (!pending.length) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const now = Date.now();
  const threshold = now - durationHours * 60 * 60 * 1000;

  for (const record of pending) {
    const reviewedAt = Number(record.reviewed_at) || 0;
    if (reviewedAt === 0 || reviewedAt > threshold) continue;

    const member = await guild.members.fetch(record.user_id).catch(() => null);
    if (member) {
      await member.roles.remove(roleId).catch((error) => {
        logger.warn(`Bewerbung ${record.application_id}: Ablehnungs-Rolle konnte nicht entfernt werden.`, error?.message ?? error);
      });
    }

    runtime.db.markBewerbungRejectRoleRemoved(guildId, record.application_id, now);
  }
}
