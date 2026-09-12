import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { refreshSupportLeaderboardPanel } from '../utils/panels.js';
import {
  publishReactionLeaderboard,
  resetReactionLeaderboard
} from '../utils/reactionLeaderboard.js';
import {
  publishStatusLeaderboard,
  resetStatusLeaderboard
} from '../utils/statusLeaderboard.js';

const TYPES = [
  { name: 'Support-Fälle', value: 'support' },
  { name: 'Status-Meldungen', value: 'status' },
  { name: 'White Check Mark', value: 'reaction' }
];

async function publish(type, interaction, runtime) {
  if (type === 'support') {
    await refreshSupportLeaderboardPanel(interaction.client, runtime);
    return '✅ Support-Leaderboard wurde aktualisiert.';
  }

  if (type === 'status') {
    return (await publishStatusLeaderboard(interaction.client, runtime)).content;
  }

  return (await publishReactionLeaderboard(interaction.client, runtime)).content;
}

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Zeigt und verwaltet die Leaderboards.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('anzeigen')
      .setDescription('Postet oder aktualisiert ein Leaderboard.')
      .addStringOption((option) => option
        .setName('typ')
        .setDescription('Das gewünschte Leaderboard')
        .setRequired(true)
        .addChoices(...TYPES)
      )
    )
    .addSubcommand((subcommand) => subcommand
      .setName('reset')
      .setDescription('Setzt ein Leaderboard zurück.')
      .addStringOption((option) => option
        .setName('typ')
        .setDescription('Das zurückzusetzende Leaderboard')
        .setRequired(true)
        .addChoices(...TYPES)
      )
    ),

  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();
    const type = interaction.options.getString('typ', true);

    if (subcommand === 'anzeigen') {
      return interaction.editReply({ content: await publish(type, interaction, runtime) });
    }

    if (type === 'support') {
      const removed = runtime.db.resetSupportLeaderboard(runtime.config.guildId);
      await refreshSupportLeaderboardPanel(interaction.client, runtime);
      return interaction.editReply({
        content: `✅ Support-Leaderboard zurückgesetzt (${removed} abgeschlossene Fälle entfernt). Laufende Fälle bleiben erhalten.`
      });
    }

    if (type === 'status') {
      resetStatusLeaderboard(runtime.db, runtime.config.guildId);
      const result = await publishStatusLeaderboard(interaction.client, runtime);
      return interaction.editReply({ content: `✅ Status-Leaderboard zurückgesetzt.\n${result.content}` });
    }

    resetReactionLeaderboard(runtime.db, runtime.config.guildId);
    const result = await publishReactionLeaderboard(interaction.client, runtime);
    return interaction.editReply({ content: `✅ White-Check-Mark-Leaderboard zurückgesetzt.\n${result.content}` });
  }
};
