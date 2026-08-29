import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  refreshAllPanels,
  syncExpiredAbsences,
  syncOpenSupportCases,
  syncWaitingRoomSupportCases
} from '../utils/panels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Aktualisiert alle dauerhaften Systeme und Panels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await syncWaitingRoomSupportCases(interaction.client, runtime).catch(() => null);
    await syncOpenSupportCases(interaction.client, runtime).catch(() => null);
    await syncExpiredAbsences(interaction.client, runtime).catch(() => null);
    await refreshAllPanels(interaction.client, runtime).catch(() => null);

    await interaction.editReply({ content: 'Alle Panels und Systeme wurden neu synchronisiert.' });
  }
};
