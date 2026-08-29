import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} from 'discord.js';
import { logger } from './logger.js';
import { formatGermanDateTime } from './time.js';

const LB_KEY = 'statusLeaderboard';
const LB_PANEL_KEY = 'statusLeaderboardPanel';

function readLeaderboard(db, guildId) {
  try {
    const raw = db.getSetting(`${LB_KEY}:${guildId}`);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeLeaderboard(db, guildId, data) {
  db.setSetting(`${LB_KEY}:${guildId}`, JSON.stringify(data));
}

/**
 * Zählt eine Status-Meldung für den Nutzer hoch.
 */
export function trackStatusReport(db, guildId, userId) {
  const data = readLeaderboard(db, guildId);
  data[userId] = (Number(data[userId]) || 0) + 1;
  writeLeaderboard(db, guildId, data);
  return data[userId];
}

/**
 * Liefert die Leaderboard-Einträge absteigend sortiert nach Anzahl der Meldungen.
 */
export function getStatusLeaderboard(db, guildId, limit = 10) {
  const data = readLeaderboard(db, guildId);
  return Object.entries(data)
    .map(([userId, count]) => ({ userId, count: Number(count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

/**
 * Baut die Leaderboard-Nachricht (Components V2).
 */
export function buildStatusLeaderboardPayload(entries = [], config = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(0xf1c40f)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**🏆 Status-Meldungen Leaderboard**'),
      new TextDisplayBuilder().setContent(
        'Rangliste der Mitglieder, die den Server-Status am häufigsten gemeldet haben.'
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (!entries.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Noch keine Meldungen vorhanden. Melde als erster die Spielerzahl über den Button!')
    );
  } else {
    const medal = ['🥇', '🥈', '🥉'];
    const lines = entries.map((entry, index) => {
      const rank = index + 1;
      const prefix = medal[index] ?? `#${rank}`;
      return `${prefix} <@${entry.userId}> — **${entry.count}** ${entry.count === 1 ? 'Meldung' : 'Meldungen'}`;
    });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Echo RP VC · Leaderboard aktualisiert · ${formatGermanDateTime(Date.now())}`)
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function findChannel(client, channelId) {
  if (!channelId) {
    return null;
  }
  return client.channels.fetch(channelId).catch(() => null);
}

/**
 * Postet oder aktualisiert die Leaderboard-Nachricht im Leaderboard-Kanal.
 */
export async function publishStatusLeaderboard(client, runtime) {
  const ss = runtime.config.serverStatus || {};
  const channelId = ss.leaderboardChannelId || ss.statusChannelId;
  if (!channelId) {
    return { ok: false, content: '❌ serverStatus.leaderboardChannelId ist nicht in der config.json gesetzt!' };
  }

  const channel = await findChannel(client, channelId);
  if (!channel?.isTextBased()) {
    return { ok: false, content: `❌ Leaderboard-Kanal mit ID ${channelId} wurde nicht gefunden!` };
  }

  const entries = getStatusLeaderboard(runtime.db, runtime.config.guildId, 10);
  const payload = buildStatusLeaderboardPayload(entries, ss);

  try {
    const stored = runtime.db.getPanelMessage(LB_PANEL_KEY);
    if (stored?.message_id) {
      const message = await channel.messages.fetch(stored.message_id).catch(() => null);
      if (message) {
        await message.edit(payload);
        return { ok: true, content: `✅ Leaderboard wurde in ${channel} aktualisiert.` };
      }
    }

    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage(LB_PANEL_KEY, runtime.config.guildId, channelId, sent.id);
    return { ok: true, content: `✅ Leaderboard wurde in ${channel} gepostet.` };
  } catch (error) {
    logger.warn(`Leaderboard-Kanal konnte nicht bearbeitet werden (${error?.message ?? error}) - wird neu erstellt.`);
    const previous = runtime.db.getPanelMessage(LB_PANEL_KEY);
    if (previous?.message_id) {
      const message = await channel.messages.fetch(previous.message_id).catch(() => null);
      if (message) {
        await message.delete().catch(() => null);
        runtime.db.deletePanelMessage(LB_PANEL_KEY);
      }
    }
    const sent = await channel.send(payload);
    runtime.db.upsertPanelMessage(LB_PANEL_KEY, runtime.config.guildId, channelId, sent.id);
    return { ok: true, content: `✅ Leaderboard wurde in ${channel} gepostet.` };
  }
}

export const statusLeaderboard = {
  trackStatusReport,
  getStatusLeaderboard,
  buildStatusLeaderboardPayload,
  publishStatusLeaderboard
};