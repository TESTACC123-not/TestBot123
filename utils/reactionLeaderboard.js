import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder
} from 'discord.js';
import { logger } from './logger.js';
import { formatGermanDateTime } from './time.js';

const LEADERBOARD_KEY = 'reactionLeaderboard';
const PANEL_KEY = 'reactionLeaderboardPanel';

function readLeaderboard(db, guildId) {
  try {
    const raw = db.getSetting(`${LEADERBOARD_KEY}:${guildId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLeaderboard(db, guildId, data) {
  db.setSetting(`${LEADERBOARD_KEY}:${guildId}`, JSON.stringify(data));
}

export function isWhiteCheckMarkReaction(reaction) {
  const emojiName = reaction?.emoji?.name;
  return emojiName === '✅' || emojiName === 'white_check_mark';
}

export function trackWhiteCheckMarkReaction(db, guildId, userId) {
  const data = readLeaderboard(db, guildId);
  data[userId] = (Number(data[userId]) || 0) + 1;
  writeLeaderboard(db, guildId, data);
  return data[userId];
}

export function getReactionLeaderboard(db, guildId, limit = 10) {
  return Object.entries(readLeaderboard(db, guildId))
    .map(([userId, count]) => ({ userId, count: Number(count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.userId.localeCompare(right.userId))
    .slice(0, limit);
}

export function resetReactionLeaderboard(db, guildId) {
  writeLeaderboard(db, guildId, {});
}

export function buildReactionLeaderboardPayload(entries = []) {
  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**✅ White-Check-Mark Leaderboard**'),
      new TextDisplayBuilder().setContent(
        entries.length
          ? 'Rangliste der Mitglieder mit den meisten :white_check_mark:-Reaktionen.'
          : 'Noch keine :white_check_mark:-Reaktionen gezählt.'
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (entries.length) {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = entries.map((entry, index) => {
      const rank = medals[index] ?? `#${index + 1}`;
      const label = entry.count === 1 ? 'Reaktion' : 'Reaktionen';
      return `${rank} <@${entry.userId}> — **${entry.count}** ${label}`;
    });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Reagiere im Zielkanal mit ✅, um im Leaderboard zu erscheinen.'));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Leaderboard aktualisiert · ${formatGermanDateTime(Date.now())}`)
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export async function publishReactionLeaderboard(client, runtime) {
  const channelId = runtime.config.reactionLeaderboard?.leaderboardChannelId || runtime.config.reactionLeaderboard?.channelId;
  if (!channelId) {
    return { ok: false, content: '❌ reactionLeaderboard.channelId ist nicht in der config.json gesetzt.' };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return { ok: false, content: `❌ Leaderboard-Kanal mit ID ${channelId} wurde nicht gefunden.` };
  }

  const payload = buildReactionLeaderboardPayload(
    getReactionLeaderboard(runtime.db, runtime.config.guildId, 10)
  );
  const stored = runtime.db.getPanelMessage(PANEL_KEY);

  try {
    if (stored?.message_id) {
      const message = await channel.messages.fetch(stored.message_id).catch(() => null);
      if (message) {
        await message.edit(payload);
        return { ok: true, content: `✅ White-Check-Mark-Leaderboard wurde in ${channel} aktualisiert.` };
      }
    }

    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage(PANEL_KEY, runtime.config.guildId, channel.id, sent.id);
    return { ok: true, content: `✅ White-Check-Mark-Leaderboard wurde in ${channel} gepostet.` };
  } catch (error) {
    logger.warn('White-Check-Mark-Leaderboard konnte nicht aktualisiert werden.', error);
    return { ok: false, content: '❌ Das White-Check-Mark-Leaderboard konnte nicht aktualisiert werden. Bitte die Bot-Berechtigungen prüfen.' };
  }
}
