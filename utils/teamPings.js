import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} from 'discord.js';
import { logger } from './logger.js';

/* ============================================================
 * CONFIG-HELFER
 * ============================================================ */

export function getTeamPings(config) {
  const pings = config.teamPings?.pings ?? [];
  return Array.isArray(pings) ? pings.filter((ping) => ping && ping.roleId) : [];
}

export function getTeamPingByRoleId(config, roleId) {
  return getTeamPings(config).find((ping) => ping.roleId === roleId) ?? null;
}

/* ============================================================
 * RENDERER
 * ============================================================ */

export function buildTeamPingsPanelPayload(config) {
  const pings = getTeamPings(config);

  const lines = pings.length
    ? pings.map((ping) => `${ping.emoji ?? ''} **${ping.label}**`).join('\n')
    : 'Noch keine Team-Pings in der config.json hinterlegt.';

  const buttons = new ActionRowBuilder();
  for (const ping of pings) {
    const button = new ButtonBuilder()
      .setCustomId(`teamping:${ping.roleId}`)
      .setLabel(ping.label)
      .setStyle(ButtonStyle.Primary);
    if (ping.emoji) {
      button.setEmoji(ping.emoji);
    }
    buttons.addComponents(button);
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('📢 **Team-Ping (Umschalt-Modul)**'),
      new TextDisplayBuilder().setContent(
        'Klicke auf eine Schaltfläche, um die Rolle zu aktivieren. Ein erneuter Klick deaktiviert sie wieder.'
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

  if (pings.length) {
    container.addActionRowComponents(buttons);
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/* ============================================================
 * PING-SENDEN
 * ============================================================ */

function hasAnyRole(member, roleIds = []) {
  return roleIds.some((roleId) => roleId && member.roles.cache.has(roleId));
}

export function isTeamPingAllowed(member, runtime) {
  if (!member) {
    return false;
  }

  if (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  const teamRoleIds = (runtime.config.roles?.teamRoles ?? []).map((role) => role.id).filter(Boolean);
  return hasAnyRole(member, teamRoleIds);
}

function getWaitingRoomChannelId(runtime, waitingRoomType) {
  if (!waitingRoomType) {
    return '';
  }
  const area = runtime.config.duty?.areas?.[waitingRoomType];
  return area?.waitingChannelId ?? '';
}

async function fetchVoiceChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isVoiceBased?.() ? channel : null;
}

/**
 * Löst den Klick eines Team-Ping-Buttons aus (Umschalt-Modul).
 *  - Hat das Mitglied die Rolle noch nicht: Rolle wird VERGEBEN. Ist der Button mit
 *    einem Warteraum verknüpft (waitingRoomType), wird der Benutzer in diesen Kanal
 *    verschoben (wie im Support-/Wartebereich-System).
 *  - Hat das Mitglied die Rolle schon: Rolle wird ENTFERNT. Bei verknüpftem Warteraum
 *    wird der Benutzer aus dem Call gekickt.
 */
export async function triggerTeamPing(interaction, runtime, roleId) {
  const ping = getTeamPingByRoleId(runtime.config, roleId);
  if (!ping) {
    return 'Dieser Team-Ping ist nicht mehr konfiguriert.';
  }

  const member = interaction.member;
  if (!member) {
    return 'Dein Mitglied konnte nicht ermittelt werden.';
  }

  const waitingRoomType = ping.waitingRoomType ?? '';
  const waitingChannelId = getWaitingRoomChannelId(runtime, waitingRoomType);
  const hasRole = member.roles.cache.has(roleId);

  try {
    if (hasRole) {
      // AUS: Rolle entfernen, aus dem Call kicken (falls Warteraum verknüpft).
      await member.roles.remove(roleId, 'Team-Ping (deaktiviert)');
      if (waitingRoomType && waitingChannelId) {
        await member.voice.disconnect().catch((error) => {
          logger.warn('Team-Ping: Benutzer konnte nicht aus dem Call gekickt werden.', error?.message ?? error);
        });
      }
      return null;
    }

    // AN: Rolle vergeben, in den Warteraum verschieben (falls verknüpft).
    await member.roles.add(roleId, 'Team-Ping (aktiviert)');
    if (waitingRoomType && waitingChannelId) {
      const channel = await fetchVoiceChannel(interaction.guild, waitingChannelId);
      if (channel) {
        await member.voice.setChannel(channel.id).catch((error) => {
          logger.warn(`Team-Ping: Benutzer konnte nicht in Warteraum ${waitingChannelId} verschoben werden.`, error?.message ?? error);
        });
      }
    }
    return null;
  } catch (error) {
    logger.warn('Team-Ping: Rollenwechsel fehlgeschlagen.', error?.message ?? error);
    return 'Der Rollenwechsel konnte nicht durchgeführt werden. Prüfe die Bot-Berechtigungen.';
  }
}
