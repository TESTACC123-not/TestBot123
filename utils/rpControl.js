import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} from 'discord.js';
import { logger } from './logger.js';

const CONTROL_PANEL_KEY = 'rpControlPanel';

function buildDivider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function codeLabel(code) {
  return code ? '\`' + code + '\`' : 'nicht konfiguriert';
}

export function buildRpControlPanelPayload(config = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(0x8e44ad)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**🎮 RP-Steuerung**'),
      new TextDisplayBuilder().setContent('Starte oder beende die Roleplay-Sitzung über einen der Buttons. Nur berechtigte Teammitglieder können den Status ändern.')
    )
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Aktueller Servercode:** ' + codeLabel(config.gameServerCode))
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rp_control_start')
          .setLabel('RP starten')
          .setEmoji('🟢')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('rp_control_stop')
          .setLabel('RP beenden')
          .setEmoji('🔴')
          .setStyle(ButtonStyle.Danger)
      )
    )
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('-# EchoRP · RP-Steuerung')
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildRpAnnouncementPayload(state, config = {}) {
  const isLive = state === 'live';
  // Eigene RP-Ping-Rolle; alte serverStatus.pingRoleId bleibt als Fallback erhalten.
  const roleId = config.rpControl?.pingRoleId ?? config.serverStatus?.pingRoleId ?? '';
  const serverCode = config.gameServerCode ?? '';
  const accentColor = isLive ? 0x57f287 : 0xed4245;
  const statusEmoji = isLive ? '🟢' : '🔴';
  const statusTitle = isLive ? 'ROLEPLAY IST GESTARTET' : 'ROLEPLAY IST BEENDET';
  const statusText = isLive
    ? 'Eine öffentliche Roleplay-Sitzung ist jetzt verfügbar.'
    : 'Derzeit findet keine Roleplay-Sitzung statt.';
  const highlightText = isLive
    ? 'Komm vorbei, erlebe Geschichten und werde Teil von EchoRP. ✨'
    : 'Wir sehen uns bei der nächsten Roleplay-Sitzung. ✨';

  const container = new ContainerBuilder().setAccentColor(accentColor);

  // Die RP-Rolle steht bewusst außerhalb des Textes, damit Discord den Ping sauber ausführt.
  if (isLive && roleId) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`<@&${roleId}>`)
    );
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${statusEmoji} ${statusTitle}`),
      new TextDisplayBuilder().setContent(`> ${statusText}`)
    )
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎮 Servercode\n\`${serverCode || 'Nicht konfiguriert'}\``
      ),
      new TextDisplayBuilder().setContent(`✨ ${highlightText}`)
    )
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isLive
          ? '-# EchoRP • Dein Roleplay, deine Geschichte'
          : '-# EchoRP • Bis gleich im nächsten RP'
      )
    );

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };

  if (isLive && roleId) {
    payload.allowedMentions = { parse: [], roles: [roleId], users: [] };
  }

  return payload;
}

export async function publishRpControlPanel(client, runtime) {
  const channelId = runtime.config.rpControl?.panelChannelId;
  logger.info(`RP-Steuerung: Panel-Start. Konfigurierter Kanal: ${channelId || 'nicht gesetzt'}.`);

  if (!channelId) {
    logger.warn('RP-Steuerung: rpControl.panelChannelId ist nicht in der config.json gesetzt.');
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch((error) => {
    logger.warn('RP-Steuerung: Panel-Kanal konnte nicht geladen werden.', error?.message ?? error);
    return null;
  });
  if (!channel?.isTextBased()) {
    logger.warn(`RP-Steuerung: Panel-Kanal ${channelId} wurde nicht gefunden oder ist kein Textkanal.`);
    return null;
  }

  logger.info(`RP-Steuerung: Panel-Kanal gefunden: #${channel.name} (${channel.id}).`);

  const payload = buildRpControlPanelPayload(runtime.config);
  const stored = runtime.db.getPanelMessage(CONTROL_PANEL_KEY);
  logger.info(
    stored?.message_id
      ? `RP-Steuerung: Gespeicherte Panel-Nachricht gefunden: ${stored.message_id}.`
      : 'RP-Steuerung: Keine gespeicherte Panel-Nachricht – neue Nachricht wird erstellt.'
  );

  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message) {
      try {
        await message.edit(payload);
        logger.info(`RP-Steuerung: Vorhandenes Panel erfolgreich aktualisiert: ${message.id}.`);
        return message;
      } catch (error) {
        logger.warn('RP-Steuerung: Bestehendes Panel konnte nicht aktualisiert werden.', error?.message ?? error);
      }
    }
  }

  try {
    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage(CONTROL_PANEL_KEY, runtime.config.guildId, channel.id, sent.id);
    logger.info(`RP-Steuerung: Neues Panel erfolgreich gesendet: ${sent.id} in #${channel.name}.`);
    return sent;
  } catch (error) {
    logger.error(
      `RP-Steuerung: Panel konnte nicht in Kanal ${channelId} gesendet werden. Der Bot braucht „Kanal ansehen“, „Nachrichten senden“ und „Nachrichtenverlauf anzeigen“.`,
      error
    );
    return null;
  }
}

export async function postRpControlAnnouncement(client, runtime, state) {
  const channelId = runtime.config.rpControl?.announcementChannelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error('rpControl.announcementChannelId ist nicht korrekt konfiguriert.');
  }

  return channel.send(buildRpAnnouncementPayload(state, runtime.config));
}
