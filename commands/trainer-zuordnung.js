import { ContainerBuilder, TextDisplayBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  refreshTrainerAssignmentsPanel,
  refreshTrainerDashboardPanel
} from '../utils/panels.js';
import * as trainerDashboard from '../utils/trainerDashboard.js';
import { formatGermanDateTime } from '../utils/time.js';

async function fetchMember(interaction, userOption) {
  if (!userOption) {
    return null;
  }

  return interaction.guild.members.fetch(userOption.id).catch(() => null);
}

function buildResultContainer(title, description, color = 0x2ecc71) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${title}**`),
      new TextDisplayBuilder().setContent(description)
    );
}

function buildResultPayload(title, description, color = 0x2ecc71) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [buildResultContainer(title, description, color)]
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('trainer-zuordnung')
    .setDescription('Verwaltet Zuordnungen zwischen ASB und T-Sup.')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('setzen')
      .setDescription('Fügt einem ASB einen weiteren T-Sup hinzu.')
      .addUserOption((option) => option
        .setName('asb')
        .setDescription('Die ASB-Person.')
        .setRequired(true))
      .addUserOption((option) => option
        .setName('tsup')
        .setDescription('Der zuständige T-Sup.')
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('entfernen')
      .setDescription('Entfernt alle Zuordnungen eines ASB.')
      .addUserOption((option) => option
        .setName('asb')
        .setDescription('Die ASB-Person.')
        .setRequired(true))),
  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const now = Date.now();

    const resolveTrainerAsbRole = trainerDashboard.resolveTrainerAsbRole ?? trainerDashboard.resolveTrainerAsblRole;
    const resolveTrainerTargetRole = trainerDashboard.resolveTrainerTargetRole;
    const asbRole = resolveTrainerAsbRole?.(runtime.config) ?? null;
    const tsupRole = resolveTrainerTargetRole?.(runtime.config) ?? null;
    if (!asbRole || !tsupRole) {
      return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
            'Die Rollen für ASB oder T-Sup wurden in der config.json nicht gefunden.',
            0xe74c3c));
    }

    if (!interaction.member.roles.cache.has(asbRole.id)) {
      return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
            'Nur Mitglieder mit der ASB-Rolle dürfen diese Zuordnung verwalten.',
            0xe74c3c));
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'setzen') {
      const asbUser = interaction.options.getUser('asb', true);
      const tsupUser = interaction.options.getUser('tsup', true);
      const asbMember = await fetchMember(interaction, asbUser);
      const tsupMember = await fetchMember(interaction, tsupUser);

      if (!asbMember || !tsupMember) {
        return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
              'Mindestens eines der beiden Mitglieder konnte im Server nicht gefunden werden.',
              0xe74c3c));
      }

      if (!asbMember.roles.cache.has(asbRole.id)) {
        return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
              `${asbMember} hat nicht die Rolle **${asbRole.label}**.`,
              0xe67e22));
      }

      if (!tsupMember.roles.cache.has(tsupRole.id)) {
        return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
              `${tsupMember} hat nicht die Rolle **${tsupRole.label}**.`,
              0xe67e22));
      }

      if (asbMember.id === tsupMember.id) {
        return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
              'ASB und T-Sup dürfen nicht dieselbe Person sein.',
              0xe67e22));
      }

      runtime.db.upsertTrainerAssignment(runtime.config.guildId, asbMember.id, tsupMember.id, null, now);
      const currentAssignments = runtime.db.getTrainerAssignmentsForAsbl(runtime.config.guildId, asbMember.id);
      const currentTsupMentions = [...new Set(currentAssignments.map((assignment) => `<@${assignment.tsup_user_id}>`))];

      await refreshTrainerDashboardPanel(interaction.client, runtime).catch(() => null);
      await refreshTrainerAssignmentsPanel(interaction.client, runtime).catch(() => null);

      const lines = [
        `**ASB:** ${asbMember}`,
        `**T-Sup:** ${tsupMember}`,
        `**Aktuelle T-Sups:** ${currentTsupMentions.join(', ')}`,
        `**Status:** Automatisch synchronisiert`,
        `**Zeitpunkt:** ${formatGermanDateTime(now)}`
      ];

      return interaction.editReply(buildResultPayload('Trainer-Zuordnung gesetzt',
            lines.join('\n'),
            0x2ecc71));
    }

    if (subcommand === 'entfernen') {
      const asbUser = interaction.options.getUser('asb', true);
      const asbMember = await fetchMember(interaction, asbUser);
      if (!asbMember) {
        return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
              'Die ASB-Person konnte im Server nicht gefunden werden.',
              0xe74c3c));
      }

      const deleted = runtime.db.deleteTrainerAssignmentByAsbl(runtime.config.guildId, asbMember.id);
      await refreshTrainerDashboardPanel(interaction.client, runtime).catch(() => null);
      await refreshTrainerAssignmentsPanel(interaction.client, runtime).catch(() => null);

      if (!deleted) {
        return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
              `${asbMember} hatte keine gespeicherte Zuordnung.`,
              0xe67e22));
      }

      return interaction.editReply(buildResultPayload('Trainer-Zuordnung entfernt',
            `${asbMember} hat jetzt keine feste T-Sup-Zuordnung mehr.`,
            0x3498db));
    }

    return interaction.editReply(buildResultPayload('Trainer-Zuordnung',
          'Unbekannte Aktion.',
          0xe74c3c));
  }
};
