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
import { getRpState } from './serverStatus.js';

const PANEL_KEY = 'icCounterStatus';

function footerLine(text) {
  return `-# ${text}`;
}

function fieldsToText(fields) {
  return fields.map((field) => `**${field.name}**\n${field.value}`).join('\n\n');
}

/**
 * Berechnet den sichtbaren Status anhand der gemeldeten Spielerzahl.
 * - keine Meldung -> keine Angabe
 * - unter offlineThreshold -> Offline
 * - unter pushThreshold -> Im Push
 * - sonst -> Online
 */
export function computeIcStatus(count, config = {}) {
  const cap = Math.max(1, Number(config.playerCap) || 50);
  const pushThreshold = Math.min(cap, Math.max(1, Number(config.pushThreshold) || 40));
  const offlineThreshold = Math.min(cap, Math.max(0, Number(config.offlineThreshold) || 5));

  if (count === null || count === undefined || Number.isNaN(Number(count))) {
    return { label: 'Keine Meldung', emoji: '⚪', color: 0x6c7a89, short: 'Keine Meldung' };
  }

  const n = Math.max(0, Math.min(cap, Math.floor(Number(count))));

  if (n < offlineThreshold) {
    return { label: 'Offline', emoji: '⚫', color: 0x95a5a6, short: 'Offline' };
  }
  if (n < pushThreshold) {
    return { label: 'Im Push', emoji: '🔴', color: 0xe74c3c, short: 'Im Push' };
  }
  return { label: 'Online', emoji: '🟢', color: 0x2ecc71, short: 'Online' };
}

export function getIcState(db, guildId) {
  try {
    const raw = db.getSetting(`icCounter:${guildId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

export function saveIcState(db, guildId, data) {
  db.setSetting(`icCounter:${guildId}`, JSON.stringify(data));
}

/**
 * Status-Nachricht (Kanal 1): zeigt immer den aktuell gemeldeten Wert,
 * wer ihn gemeldet hat und den berechneten Status.
 */
export function buildIcStatusPayload(state, config = {}) {
  const cap = Math.max(1, Number(config.playerCap) || 50);
  const status = computeIcStatus(state?.playerCount ?? null, config);
  const capLabel = config.playerCap ? String(cap) : '50';

  const fields = [
    { name: 'Server', value: 'Echo RP VC' },
    {
      name: 'Spieler',
      value: state && state.playerCount !== undefined && state.playerCount !== null
        ? `${state.playerCount}/${capLabel}`
        : `–/${capLabel}`
    },
    { name: 'Serverstatus', value: `${status.emoji} ${status.label}` }
  ];

  if (state?.reportedById) {
    fields.push({ name: 'Zuletzt gemeldet von', value: `<@${state.reportedById}>`, inline: true });
  }

  if (state?.updatedAt) {
    fields.push({ name: 'Zuletzt aktualisiert', value: formatGermanDateTime(state.updatedAt), inline: true });
  }

  const container = new ContainerBuilder()
    .setAccentColor(status.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**✨ Echo RP VC • Ingame Server Status**'),
      new TextDisplayBuilder().setContent(
        state?.playerCount === undefined || state?.playerCount === null
          ? 'Es wurde noch keine Spielerzahl gemeldet.'
          : `${status.emoji} Der Server ist ${status.label.toLowerCase()}.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToText(fields)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine(`Echo RP VC • Ingame Server Status · ${formatGermanDateTime(Date.now())}`))
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Ping-Nachricht (Kanal 2): pingt die feste Rolle und bietet den Button
 * zum Öffnen des Eingabefensters. Hat bereits jemand eine Spielerzahl
 * gemeldet, wird der Button deaktiviert und der Melder angezeigt.
 */
export function buildIcPingPayload(config = {}, state = null) {
  const cap = Math.max(1, Number(config.playerCap) || 50);
  const pingRoleId = config.pingRoleId ?? '';
  const alreadyReported = Boolean(state?.reportedById && state?.playerCount !== undefined && state?.playerCount !== null);

  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2);

  if (!alreadyReported && pingRoleId) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${pingRoleId}>`));
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(alreadyReported ? '**📊 Spielerzahl bereits gemeldet**' : '**📊 Spielerzahl melden**'),
      new TextDisplayBuilder().setContent(
        alreadyReported
          ? `Bereits gemeldet von <@${state.reportedById}>: **${state.playerCount}/${cap}**. Eine erneute Eingabe ist aktuell nicht möglich.`
          : `Drücke auf den Button und gib ein, wie viele Spieler aktuell Ingame (IC) sind (max. ${cap}).`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        fieldsToText([
          alreadyReported
            ? { name: 'Meldung abgeschlossen', value: `Die Spielerzahl wurde von <@${state.reportedById}> gemeldet. Der Status ist bereits aktualisiert.` }
            : { name: 'Wir brauchen deine Meldung!', value: 'Die aktuelle Spielerzahl wird im Status-Kanal angezeigt.' },
          { name: 'Automatik', value: alreadyReported ? 'Der Button wird aktiviert, sobald eine neue Meldung benötigt wird.' : 'Diese Rolle wird alle konfigurierten Minuten gepingt, bis gemeldet wird.' }
        ])
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ic_counter_report')
          .setLabel(alreadyReported ? 'Bereits gemeldet' : 'Spielerzahl eingeben')
          .setStyle(alreadyReported ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(alreadyReported)
      )
    );

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };

  if (!alreadyReported && pingRoleId) {
    payload.allowedMentions = { parse: [], roles: [pingRoleId], users: [], repliedUser: false };
  }

  return payload;
}

function isConfigured(config) {
  return Boolean(config.statusChannelId && config.messageChannelId);
}

async function findChannel(client, channelId) {
  if (!channelId) {
    return null;
  }
  return client.channels.fetch(channelId).catch(() => null);
}

/**
 * Kanal 1: Status-Nachricht posten/aktualisieren.
 */
export async function updateIcStatusPanel(client, runtime) {
  const ic = runtime.config.icCounter || {};
  if (!isConfigured(ic)) {
    return;
  }

  if (getRpState(runtime.db, runtime.config.guildId) === 'stop') {
    return;
  }

  const channel = await findChannel(client, ic.statusChannelId);
  if (!channel?.isTextBased()) {
    logger.warn('IC-Counter: Status-Kanal konnte nicht gefunden werden.');
    return;
  }

  const state = getIcState(runtime.db, runtime.config.guildId);
  const payload = buildIcStatusPayload(state, ic);

  try {
    const stored = runtime.db.getPanelMessage(PANEL_KEY);
    if (stored?.message_id) {
      const message = await channel.messages.fetch(stored.message_id).catch(() => null);
      if (message) {
        await message.edit(payload);
        return;
      }
    }

    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage(PANEL_KEY, runtime.config.guildId, ic.statusChannelId, sent.id);
  } catch (error) {
    logger.warn(`IC-Counter: Status-Nachricht konnte nicht gesendet/bearbeitet werden (${error?.message ?? error}) - wird neu erstellt.`);
    const previous = runtime.db.getPanelMessage(PANEL_KEY);
    if (previous?.message_id) {
      const message = await channel.messages.fetch(previous.message_id).catch(() => null);
      if (message) {
        await message.delete().catch(() => null);
        runtime.db.deletePanelMessage(PANEL_KEY);
      }
    }
    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage(PANEL_KEY, runtime.config.guildId, ic.statusChannelId, sent.id);
  }
}

/**
 * Kanal 2: Ping-Nachricht senden. Löscht vorher die alte, damit die
 * Rolle bei jedem Zyklus erneut gepingt wird und der Kanal sauber bleibt.
 */
export async function sendIcPing(client, runtime) {
  const ic = runtime.config.icCounter || {};
  if (!ic.messageChannelId) {
    return;
  }

  if (getRpState(runtime.db, runtime.config.guildId) === 'stop') {
    return;
  }

  const channel = await findChannel(client, ic.messageChannelId);
  if (!channel?.isTextBased()) {
    logger.warn('IC-Counter: Nachrichten-Kanal konnte nicht gefunden werden.');
    return;
  }

  if (runtime.icCounter?.pingMessageId) {
    const old = await channel.messages.fetch(runtime.icCounter.pingMessageId).catch(() => null);
    if (old) {
      await old.delete().catch(() => null);
    }
  }

  const state = getIcState(runtime.db, runtime.config.guildId);
  const payload = buildIcPingPayload(ic, state);
  const sent = await channel.send(payload);
  runtime.icCounter = { ...(runtime.icCounter || {}), pingMessageId: sent.id };
  return sent;
}

export async function startIcCounterLoop(client, runtime) {
  const ic = runtime.config.icCounter || {};
  if (!isConfigured(ic)) {
    logger.info('IC-Counter deaktiviert, weil icCounter-Status- oder Nachrichten-Kanal nicht konfiguriert sind.');
    return;
  }

  if (runtime.icCounter?.timer) {
    clearInterval(runtime.icCounter.timer);
  }

  await updateIcStatusPanel(client, runtime);
  await sendIcPing(client, runtime);

  const intervalMs = Math.max(1, Number(ic.intervalMinutes) || 5) * 60_000;
  runtime.icCounter = { ...(runtime.icCounter || {}), timer: null };

  runtime.icCounter.timer = setInterval(async () => {
    try {
      await sendIcPing(client, runtime);
    } catch (error) {
      logger.error('IC-Counter: Ping-Zyklus fehlgeschlagen.', error);
    }
  }, intervalMs);

  logger.info(`IC-Counter gestartet - Ping alle ${intervalMs / 60_000} Minuten in Kanal ${ic.messageChannelId}, Status in Kanal ${ic.statusChannelId}.`);
  return runtime.icCounter.timer;
}

export function stopIcCounterLoop(runtime) {
  if (runtime.icCounter?.timer) {
    clearInterval(runtime.icCounter.timer);
    runtime.icCounter.timer = null;
  }
}

export const icCounterHandle = {
  updateIcStatusPanel,
  sendIcPing,
  startIcCounterLoop,
  stopIcCounterLoop,
  getIcState,
  saveIcState,
  buildIcStatusPayload,
  buildIcPingPayload
};