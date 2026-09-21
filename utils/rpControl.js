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
  const roleId = config.serverStatus?.pingRoleId ?? '';
  const serverCode = config.gameServerCode ?? '';
  const container = new ContainerBuilder()
    .setAccentColor(isLive ? 0x2ecc71 : 0xe74c3c);

  if (isLive && roleId) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('<@&' + roleId + '>'));
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(isLive ? '**🟢 Das RP hat begonnen!**' : '**🔴 Das RP ist beendet!**'),
      new TextDisplayBuilder().setContent(
        isLive
          ? 'Es findet eine **öffentliche Roleplay-Sitzung** statt.'
          : 'Es findet **keine Roleplay-Sitzung** statt.'
      ),
      new TextDisplayBuilder().setContent('**Servercode:** ' + codeLabel(serverCode)),
      new TextDisplayBuilder().setContent(
        isLive
          ? 'Wir freuen uns, dich begrüßen zu dürfen! 👋'
          : 'Komm gerne bei der **nächsten Roleplay-Sitzung** vorbei! 🧡'
      )
    )
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**━━━━━━━━ EchoRP ━━━━━━━━**'));

  const payload = { flags: MessageFlags.IsComponentsV2, components: [container] };
  if (isLive && roleId) {
    payload.allowedMentions = { parse: [], roles: [roleId] };
  }
  return payload;
}

export async function publishRpControlPanel(client, runtime) {
  const channelId = runtime.config.rpControl?.channelId;
  if (!channelId) {
    logger.warn('RP-Steuerung: rpControl.channelId ist nicht in der config.json gesetzt.');
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    logger.warn('RP-Steuerung: Der feste Panel-Kanal wurde nicht gefunden.');
    return null;
  }

  const payload = buildRpControlPanelPayload(runtime.config);
  const stored = runtime.db.getPanelMessage(CONTROL_PANEL_KEY);
  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message) {
      await message.edit(payload);
      return message;
    }
  }

  const sent = await channel.send(payload);
  runtime.db.upsertPanelMessage(CONTROL_PANEL_KEY, runtime.config.guildId, channel.id, sent.id);
  return sent;
}

export async function postRpControlAnnouncement(client, runtime, state) {
  const channelId = runtime.config.rpControl?.channelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error('rpControl.channelId ist nicht korrekt konfiguriert.');
  }

  return channel.send(buildRpAnnouncementPayload(state, runtime.config));
}
