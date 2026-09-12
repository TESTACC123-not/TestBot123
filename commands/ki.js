import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  buildAssistantHelp,
  forgetAssistantKnowledge,
  getAssistantKnowledge,
  teachAssistant
} from '../utils/aiAssistant.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ki')
    .setDescription('Verwaltet das Wissen des lokalen Server-Assistenten.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('lernen')
      .setDescription('Bringt der KI eine Frage und passende Antwort bei.')
      .addStringOption((option) => option.setName('frage').setDescription('Die Frage').setRequired(true).setMaxLength(200))
      .addStringOption((option) => option.setName('antwort').setDescription('Die Antwort').setRequired(true).setMaxLength(1800))
    )
    .addSubcommand((subcommand) => subcommand
      .setName('vergessen')
      .setDescription('Entfernt eine zuvor gelernte Frage.')
      .addStringOption((option) => option.setName('frage').setDescription('Die gelernte Frage').setRequired(true).setMaxLength(200))
    )
    .addSubcommand((subcommand) => subcommand
      .setName('wissen')
      .setDescription('Zeigt die selbst beigebrachten Fragen.')
    )
    .addSubcommand((subcommand) => subcommand
      .setName('hilfe')
      .setDescription('Zeigt die Funktionen der KI.')
    ),

  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'lernen') {
      const result = teachAssistant(
        runtime.db,
        runtime.config.guildId,
        interaction.options.getString('frage', true),
        interaction.options.getString('antwort', true)
      );
      return interaction.editReply({
        content: result.ok
          ? '✅ Gespeichert. ' + (result.updated ? 'Die bestehende Antwort wurde ersetzt.' : 'Die KI kennt diese Frage jetzt.')
          : '❌ ' + result.message
      });
    }

    if (subcommand === 'vergessen') {
      const removed = forgetAssistantKnowledge(
        runtime.db,
        runtime.config.guildId,
        interaction.options.getString('frage', true)
      );
      return interaction.editReply({
        content: removed ? '✅ Die gelernte Antwort wurde entfernt.' : 'ℹ️ Zu dieser exakten Frage war kein Wissen gespeichert.'
      });
    }

    if (subcommand === 'wissen') {
      const knowledge = getAssistantKnowledge(runtime.db, runtime.config.guildId);
      const questions = knowledge.map((entry, index) => (index + 1) + '. ' + entry.question).join('\n');
      return interaction.editReply({
        content: knowledge.length
          ? '**Gelernte Fragen (' + knowledge.length + ')**\n' + questions.slice(0, 1700)
          : 'Noch keine eigenen Frage-Antwort-Paare gespeichert.'
      });
    }

    return interaction.editReply({ content: buildAssistantHelp() });
  }
};
