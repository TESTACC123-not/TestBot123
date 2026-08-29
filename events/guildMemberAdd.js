import { buildWelcomeCard } from '../utils/welcomeCards.js';
import { logger } from '../utils/logger.js';

function applyTemplate(template, member) {
  return template
    .replaceAll('{user}', member.user.toString())
    .replaceAll('{memberCount}', String(member.guild.memberCount));
}

export default {
  name: 'guildMemberAdd',
  once: false,
  async execute(member, runtime) {
    if (member.user.bot) {
      return;
    }

    const isVerified = runtime.db.isVerified(runtime.config.guildId, member.id);

    try {
      if (isVerified && runtime.config.roles.citizenRoleId) {
        await member.roles.add(runtime.config.roles.citizenRoleId).catch((error) => {
          logger.warn('Bürger-Rolle konnte nicht vergeben werden.', error?.message ?? error);
        });
        if (runtime.config.roles.unverifyRoleId) {
          await member.roles.remove(runtime.config.roles.unverifyRoleId).catch(() => null);
        }
      } else if (runtime.config.roles.unverifyRoleId) {
        await member.roles.add(runtime.config.roles.unverifyRoleId).catch((error) => {
          logger.warn('Unverify-Rolle konnte nicht vergeben werden.', error?.message ?? error);
        });
      }
    } catch (error) {
      logger.error('Rollenvergabe beim Join ist fehlgeschlagen.', error);
    }

    // Willkommens-Text ist fest im Code hinterlegt (nicht in der config.json).
    const template =
      'Willkommen {user}! Lies dir bitte die Regeln durch und stelle dich gerne kurz im Vorstellungsbereich vor. Bei Fragen hilft dir unser Team weiter.';
    if (runtime.config.channels.welcomeChannelId) {
      const channel = await member.guild.channels.fetch(runtime.config.channels.welcomeChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send(buildWelcomeCard(member, applyTemplate(template, member))).catch((error) => {
          logger.warn('Willkommensnachricht konnte nicht gesendet werden.', error?.message ?? error);
        });
      }
    }

    // Join-Logs sind deaktiviert.
  }
};