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
    ? pings.map((ping) => `${ping.emoji ?? ''} **${ping.label}** – <@&${ping.roleId}>`).join('\n')
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
      new TextDisplayBuilder().setContent('📢 **Team-Ping**'),
      new TextDisplayBuilder().setContent('Wähle eine Schaltfläche, um die jeweilige Team-Gruppe zu benachrichtigen.')
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

/**
 * Löst den Klick eines Team-Ping-Buttons aus.
 * Die zur Schaltfläche gehörende Rolle wird dem klickenden Mitglied ZUGEWIESEN
 * (kein Ping, keine Nachricht). Der Mentionable-Status der Rolle wird dabei nicht geändert.
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

  try {
    await member.roles.add(roleId, 'Team-Ping');
  } catch (error) {
    logger.warn('Team-Ping: Rolle konnte nicht zugewiesen werden.', error?.message ?? error);
    return 'Die Rolle konnte nicht zugewiesen werden. Prüfe die Bot-Berechtigungen.';
  }

  return null;
}
