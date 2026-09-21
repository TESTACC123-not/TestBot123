import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { postRpControlAnnouncement } from '../utils/rpControl.js';
import { setRpState } from '../utils/serverStatus.js';

function isAllowed(member, runtime) {
  if (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild)
  ) return true;

  const allowedRoleIds = runtime.config.rpControl?.allowedRoleIds ?? [];
  return allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function handleRpControl(interaction, runtime, state) {
  if (!isAllowed(interaction.member, runtime)) {
    return interaction.reply({
      content: '❌ Du bist nicht berechtigt, den RP-Status zu ändern.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    setRpState(runtime.db, runtime.config.guildId, state);
    await postRpControlAnnouncement(interaction.client, runtime, state);
    await interaction.editReply({
      content: state === 'live'
        ? '✅ RP wurde gestartet und die Ankündigung wurde gepostet.'
        : '✅ RP wurde beendet und die Ankündigung wurde gepostet.'
    });
  } catch (error) {
    await interaction.editReply({
      content: '❌ Die RP-Ankündigung konnte nicht gepostet werden. Prüfe serverStatus.rpChannelId und die Bot-Berechtigungen.'
    });
  }
}

export default [
  {
    name: 'rp_control_start',
    match: (customId) => customId === 'rp_control_start',
    execute: (interaction, runtime) => handleRpControl(interaction, runtime, 'live')
  },
  {
    name: 'rp_control_stop',
    match: (customId) => customId === 'rp_control_stop',
    execute: (interaction, runtime) => handleRpControl(interaction, runtime, 'stop')
  }
];
