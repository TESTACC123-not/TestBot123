import {
  isWhiteCheckMarkReaction,
  publishReactionLeaderboard,
  trackWhiteCheckMarkReaction
} from '../utils/reactionLeaderboard.js';
import { logger } from '../utils/logger.js';

export default {
  name: 'messageReactionAdd',
  once: false,
  async execute(reaction, user, runtime) {
    if (user?.bot || !reaction?.message?.guildId) {
      return;
    }

    if (reaction.partial) {
      await reaction.fetch().catch(() => null);
    }
    if (reaction.message?.partial) {
      await reaction.message.fetch().catch(() => null);
    }

    // Einige Discord.js-Versionen reichen bei Reaktions-Events zusätzliche
    // Argumente weiter. Deshalb die Runtime bevorzugt am Client auflösen.
    const activeRuntime = reaction.client?.runtime?.config
      ? reaction.client.runtime
      : runtime?.config
        ? runtime
        : null;
    const config = activeRuntime?.config?.reactionLeaderboard ?? {};
    if (!activeRuntime || !config.channelId || reaction.message?.channelId !== config.channelId) {
      return;
    }

    // Jede Emoji-Reaktion zählt; Unicode-, animierte und benutzerdefinierte Emojis werden akzeptiert.\n    if (!isWhiteCheckMarkReaction(reaction)) {
      return;
    }

    trackWhiteCheckMarkReaction(activeRuntime.db, reaction.message.guildId, user.id);

    await publishReactionLeaderboard(reaction.client, activeRuntime).catch((error) => {
      logger.warn('Reaktions-Leaderboard konnte nach einer Reaktion nicht aktualisiert werden.', error);
    });
  }
};
