import { buildGoodbyeCard } from '../utils/welcomeCards.js';
import { logger, sendLog } from '../utils/logger.js';
import { refreshTeamListPanel, refreshTrainerAssignmentsPanel, refreshTrainerDashboardPanel, syncAutomaticTrainerAssignments } from '../utils/panels.js';

function applyTemplate(template, member) {
  return template.replaceAll('{user}', member.user.toString());
}

export default {
  name: 'guildMemberRemove',
  once: false,
  async execute(member, runtime) {
    if (member.user.bot) {
      return;
    }

    runtime.db.removeMemberData(runtime.config.guildId, member.id);
    runtime.db.deleteTrainerAssignmentByAsbl(runtime.config.guildId, member.id);
    runtime.db.deleteTrainerAssignmentsByTsup(runtime.config.guildId, member.id);
    await syncAutomaticTrainerAssignments(member.client, runtime).catch(() => null);

    // Verabschiedungs-Text ist fest im Code hinterlegt (nicht in der config.json).
    const template = 'Auf Wiedersehen {user}! Wir wünschen dir alles Gute und hoffen, dich bald wiederzusehen.';
    if (runtime.config.channels.goodbyeChannelId) {
      const channel = await member.guild.channels.fetch(runtime.config.channels.goodbyeChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send(buildGoodbyeCard(member, applyTemplate(template, member))).catch((error) => {
          logger.warn('Verabschiedungsnachricht konnte nicht gesendet werden.', error?.message ?? error);
        });
      }
    }

    await refreshTeamListPanel(member.client, runtime).catch((error) => {
      logger.warn('Teamliste konnte nach einem Serveraustritt nicht aktualisiert werden.', error?.message ?? error);
    });

    await refreshTrainerDashboardPanel(member.client, runtime).catch((error) => {
      logger.warn('Ausbilder-Dashboard konnte nach einem Serveraustritt nicht aktualisiert werden.', error?.message ?? error);
    });

    await refreshTrainerAssignmentsPanel(member.client, runtime).catch((error) => {
      logger.warn('ASB-Zuordnungsliste konnte nach einem Serveraustritt nicht aktualisiert werden.', error?.message ?? error);
    });

    await sendLog(
      member.client,
      runtime.config.channels.supportLogChannelId,
      'Mitglied verlassen',
      `<@${member.id}> hat den Server verlassen.`,
      0x95a5a6,
      [{ name: 'Mitglied', value: `<@${member.id}>`, inline: true }]
    );
  }
};
