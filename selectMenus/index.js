  import { MessageFlags } from 'discord.js';
import * as trainerDashboard from '../utils/trainerDashboard.js';

async function handleTrainerDashboardSelect(interaction, runtime) {
  if (!trainerDashboard.isTrainerDashboardAllowed(interaction.member, runtime)) {
    return interaction.reply({
      content: 'Du bist nicht berechtigt, das Ausbilder-Dashboard zu nutzen.',
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
  }

  await interaction.deferUpdate();

  const selectedMemberId = interaction.values?.[0] ?? null;
  const buildTrainerDashboardPickerPayload =
    trainerDashboard.buildTrainerDashboardPickerPayload ??
    (async () => trainerDashboard.buildTrainerDashboardPanelPayload?.() ?? {
      content: 'Das Ausbilder-Dashboard konnte nicht geladen werden.'
    });

  const payload = await buildTrainerDashboardPickerPayload(interaction.guild, runtime, selectedMemberId);
  await interaction.editReply(payload).catch(() => null);
}

export default [
  {
    name: 'trainer_dashboard_select',
    match: (customId) =>
      customId === 'trainer_dashboard_select' ||
      customId === 'ausbilder_dashboard_select' ||
      customId.startsWith('trainer_dashboard') ||
      customId.startsWith('ausbilder_dashboard'),
    execute: (interaction, runtime) => handleTrainerDashboardSelect(interaction, runtime)
  }
];
