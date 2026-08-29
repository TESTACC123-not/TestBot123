import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { startIcCounterLoop } from '../utils/icCounter.js';
import { setRpState, getRpState } from '../utils/serverStatus.js';
import { publishStatusLeaderboard } from '../utils/statusLeaderboard.js';

const RP_STATE_LABEL = {
  live: '🟢 RP-LIVE',
  stop: '🛑 RP-STOP'
};

export default {
  data: new SlashCommandBuilder()
    .setName('serverstatus')
    .setDescription('Verwaltet den Server-Status-Ping und den RP-Modus.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('start')
      .setDescription('Startet den Server-Status-Ping für den Tag (jeden Morgen ausführen).')
    )
    .addSubcommand((subcommand) => subcommand
      .setName('rp')
      .setDescription('Setzt den RP-Modus manuell.')
      .addStringOption((option) => option
        .setName('modus')
        .setDescription('RP-Modus')
        .setRequired(true)
        .addChoices(
          { name: 'RP-START', value: 'live' },
          { name: 'RP-STOP', value: 'stop' }
        )
      )
    )
    .addSubcommand((subcommand) => subcommand
      .setName('leaderboard')
      .setDescription('Postet bzw. aktualisiert das Status-Meldungen-Leaderboard.')
    ),

  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
      // Neuer Tag beginnt -> RP-Modus auf "live" setzen und Ping-Schleife neu starten.
      setRpState(runtime.db, runtime.config.guildId, 'live');

      try {
        await startIcCounterLoop(interaction.client, runtime);
      } catch (error) {
        return interaction.editReply({ content: '❌ Der Server-Status-Ping konnte nicht gestartet werden. Bitte Logs prüfen.' });
      }

      return interaction.editReply({
        content: `✅ Server-Status-Ping wurde gestartet (5-Minuten-Takt). RP-Modus aktiviert: ${RP_STATE_LABEL.live}.`
      });
    }

    if (subcommand === 'rp') {
      const mode = interaction.options.getString('modus');
      setRpState(runtime.db, runtime.config.guildId, mode === 'live' ? 'live' : 'stop');
      const current = getRpState(runtime.db, runtime.config.guildId);

      let content = `✅ RP-Modus gesetzt auf ${RP_STATE_LABEL[current]}.`;
      if (current === 'stop') {
        content += ' Es werden keine Server-Status-Updates mehr gepostet.';
      } else {
        content += ' Status-Pings laufen wieder.';
      }
      return interaction.editReply({ content });
    }

    if (subcommand === 'leaderboard') {
      try {
        const result = await publishStatusLeaderboard(interaction.client, runtime);
        return interaction.editReply({ content: result.content });
      } catch (error) {
        return interaction.editReply({ content: '❌ Das Leaderboard konnte nicht gepostet bzw. aktualisiert werden. Bitte Logs prüfen.' });
      }
    }

    return interaction.editReply({ content: '❌ Unbekanntes Subcommand!' });
  }
};