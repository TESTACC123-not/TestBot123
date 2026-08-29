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
 * Löst den Ping eines Team-Ping-Buttons aus.
 *  - Wenn teamPings.pingChannelId gesetzt ist, wird die Ping-Nachricht dorthin gesendet.
 *  - Andernfalls wird der Ping im Kanal gepostet, in dem geklickt wurde.
 * Die Rolle wird kurzzeitig "mentionable" gemacht, damit der Ping garantiert funktioniert,
 * und danach zurückgesetzt.
 */
export async function triggerTeamPing(interaction, runtime, roleId) {
  const ping = getTeamPingByRoleId(runtime.config, roleId);
  if (!ping) {
    return 'Dieser Team-Ping ist nicht mehr konfiguriert.';
  }

  const targetChannelId = runtime.config.teamPings?.pingChannelId ?? interaction.channelId;
  const targetChannel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
  if (!targetChannel?.isTextBased()) {
    logger.warn(`Team-Ping: Ping-Kanal ${targetChannelId} konnte nicht gefunden werden.`);
    return 'Der Zielkanal für Pings konnte nicht gefunden werden.';
  }

  // Rolle kurzzeitig mentionable machen, damit der Ping zuverlässig ankommt.
  let roleWasMentionable = false;
  let roleBackup = null;
  try {
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (role && !role.mentionable) {
      roleBackup = role.mentionable;
      await role.setMentionable(true, 'Team-Ping');
      roleWasMentionable = true;
    }
  } catch (error) {
    logger.warn('Team-Ping: Rolle konnte nicht mentionable gesetzt werden.', error?.message ?? error);
  }

  const mention = `<@&${roleId}>`;
  const line = `${ping.emoji ? `${ping.emoji} ` : ''}**${ping.label}** – ${mention}`;

  try {
    await targetChannel.send({
      content: line,
      allowedMentions: { parse: [], roles: [roleId], users: [] }
    });
  } catch (error) {
    logger.warn('Team-Ping-Nachricht konnte nicht gesendet werden.', error?.message ?? error);
    if (roleWasMentionable) {
      await interaction.guild.roles.fetch(roleId).then((role) => role.setMentionable(roleBackup ?? false, 'Team-Ping Reset')).catch(() => null);
    }
    return 'Die Ping-Nachricht konnte nicht gesendet werden. Prüfe die Kanal-Berechtigungen.';
  }

  // Mentionable-Status zurücksetzen.
  if (roleWasMentionable) {
    setTimeout(async () => {
      try {
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (role) {
          await role.setMentionable(roleBackup ?? false, 'Team-Ping Reset');
        }
      } catch (error) {
        logger.warn('Team-Ping: mentionable-Status konnte nicht zurückgesetzt werden.', error?.message ?? error);
      }
    }, 1500);
  }

  return null;
}
