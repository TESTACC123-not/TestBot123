import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { sendServerPushAnnouncement } from '../utils/serverStatus.js';

export default {
  data: new SlashCommandBuilder()
    .setName('serverpush')
    .setDescription('Postet die Server-Push-Ankündigung (Staff-Ping + Status-Rollen-Button) in den Push-Kanal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await sendServerPushAnnouncement(interaction.client, runtime);

    return interaction.editReply({ content: result.content });
  }
};