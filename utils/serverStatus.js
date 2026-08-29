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
import { logger } from './logger.js';
import { formatGermanDateTime } from './time.js';

const RP_KEY = 'serverStatus:rpState';
const RP_MESSAGE_KEY = 'serverStatusRpMessage';
const PUSH_KEY = 'serverStatusPush';

export function getRpState(db, guildId) {
  try {
    const raw = db.getSetting(RP_KEY);
    return raw === 'live' ? 'live' : 'stop';
  } catch (error) {
    return 'stop';
  }
}

export function setRpState(db, guildId, state) {
  db.setSetting(RP_KEY, state === 'live' ? 'live' : 'stop');
}

function footer(text) {
  return `-# ${text}`;
}

/**
 * RP-START / RP-STOP Ankündigung für den RP-Kanal.
 */
export function buildRpTransitionPayload(state, config = {}) {
  const isLive = state === 'live';
  const stopTh = Math.max(0, Number(config.rpStopThreshold) || 10);
  const startTh = Math.max(0, Number(config.rpStartThreshold) || 30);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(isLive ? 0x2ecc71 : 0xe74c3c)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(isLive ? '**🚦 RP-START**' : '**🛑 RP-STOP**'),
          new TextDisplayBuilder().setContent(
            isLive
              ? `Die Spielerzahl liegt über ${startTh}. Der RP ist jetzt **gestartet** — die Status-Pings laufen wieder (5-Minuten-Takt).`
              : `Die Spielerzahl liegt unter ${stopTh}. Der RP ist jetzt **gestoppt** — es werden keine Server-Status-Updates mehr gepostet.`
          )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(footer(`Echo RP VC · Status automatisch geändert · ${formatGermanDateTime(Date.now())}`))
        )
    ]
  };
}

/**
 * Baul die Server-Push-Ankündigung mit Staff-Ping und Status-Rollen-Button.
 */
export function buildServerPushPayload(config = {}) {
  const staffRoleId = config.staffRoleId ?? '';

  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71);

  if (staffRoleId) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${staffRoleId}>`));
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**📣 Server-Push**'),
      new TextDisplayBuilder().setContent(
        'Der Server ist offen. Über den Button unten kannst du die Status-Rolle für dich selbst ein- oder ausschalten, um Status-Pings zu erhalten.'
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Status-Rolle wechseln:** <@&${config.statusRoleId ?? ''}>`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('serverpush_role_toggle')
          .setLabel('Status-Rolle umschalten')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄')
      )
    );

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };

  if (staffRoleId) {
    payload.allowedMentions = { parse: [], roles: [staffRoleId] };
  }

  return payload;
}

async function findChannel(client, channelId) {
  if (!channelId) {
    return null;
  }
  return client.channels.fetch(channelId).catch(() => null);
}

/**
 * Postet die RP-START / RP-STOP Ankündigung in den festgelegten Kanal.
 */
export async function postRpTransition(client, runtime, state) {
  const ss = runtime.config.serverStatus || {};
  if (!ss.rpChannelId) {
    logger.warn('Server-Status: rpChannelId ist nicht in der config.json gesetzt - RP-Wechsel wird nicht gepostet.');
    return;
  }

  const channel = await findChannel(client, ss.rpChannelId);
  if (!channel?.isTextBased()) {
    logger.warn('Server-Status: RP-Kanal konnte nicht gefunden werden.');
    return;
  }

  const payload = buildRpTransitionPayload(state, ss);

  const stored = runtime.db.getPanelMessage(RP_MESSAGE_KEY);
  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message) {
      await message.edit(payload);
      return;
    }
  }

  const sent = await channel.send(payload);
  runtime.db.upsertPanelMessage(RP_MESSAGE_KEY, runtime.config.guildId, ss.rpChannelId, sent.id);
}

/**
 * Postet die Server-Push-Ankündigung in den Push-Kanal.
 */
export async function sendServerPushAnnouncement(client, runtime) {
  const ss = runtime.config.serverStatus || {};
  if (!ss.pushChannelId) {
    return { ok: false, content: '❌ serverStatus.pushChannelId ist in der config.json nicht gesetzt!' };
  }

  const channel = await findChannel(client, ss.pushChannelId);
  if (!channel?.isTextBased()) {
    return { ok: false, content: `❌ Push-Kanal mit ID ${ss.pushChannelId} wurde nicht gefunden!` };
  }

  const pushConfig = {
    ...ss,
    staffRoleId: ss.staffRoleId || ss.pingRoleId || ''
  };

  const payload = buildServerPushPayload(pushConfig);

  const stored = runtime.db.getPanelMessage(PUSH_KEY);
  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message) {
      await message.edit(payload);
      return { ok: true, content: `✅ Server-Push-Ankündigung wurde in ${channel} aktualisiert.` };
    }
  }

  const sent = await channel.send(payload);
  runtime.db.upsertPanelMessage(PUSH_KEY, runtime.config.guildId, ss.pushChannelId, sent.id);
  return { ok: true, content: `✅ Server-Push-Ankündigung wurde in ${channel} gepostet.` };
}

/**
 * Automatische Prüfung beim neuen Spielerstand:
 * - unter rpStopThreshold -> RP-STOP im Kanal posten
 * - über rpStartThreshold  -> RP-START im Kanal posten
 * Unnötige Wiederholungen werden übersprungen (nur bei Wechsel).
 */
export async function autoCheckRpState(client, runtime, playerCount) {
  const ss = runtime.config.serverStatus || {};
  const stopTh = Math.max(0, Number(ss.rpStopThreshold) || 10);
  const startTh = Math.max(0, Number(ss.rpStartThreshold) || 30);
  const current = getRpState(runtime.db, runtime.config.guildId);

  if (playerCount === null || playerCount === undefined || Number.isNaN(Number(playerCount))) {
    return { changed: false, state: current };
  }

  const count = Math.max(0, Math.floor(Number(playerCount)));

  if (count < stopTh && current !== 'stop') {
    setRpState(runtime.db, runtime.config.guildId, 'stop');
    await postRpTransition(client, runtime, 'stop');
    return { changed: true, state: 'stop' };
  }

  if (count > startTh && current !== 'live') {
    setRpState(runtime.db, runtime.config.guildId, 'live');
    await postRpTransition(client, runtime, 'live');
    return { changed: true, state: 'live' };
  }

  return { changed: false, state: current };
}

export const serverStatus = {
  getRpState,
  setRpState,
  buildRpTransitionPayload,
  buildServerPushPayload,
  postRpTransition,
  sendServerPushAnnouncement,
  autoCheckRpState
};