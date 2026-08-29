import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message, ...meta) {
    console.log(`[${timestamp()}] INFO: ${message}`, ...meta);
  },
  warn(message, ...meta) {
    console.warn(`[${timestamp()}] WARN: ${message}`, ...meta);
  },
  error(message, ...meta) {
    console.error(`[${timestamp()}] ERROR: ${message}`, ...meta);
  },
  debug(message, ...meta) {
    if (process.env.DEBUG_BOT === '1') {
      console.debug(`[${timestamp()}] DEBUG: ${message}`, ...meta);
    }
  }
};

export async function sendLog(client, channelId, title, description, color = 0x5865f2, fields = []) {
  if (!channelId) {
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${title}**`),
      new TextDisplayBuilder().setContent(description)
    );

  if (fields.length) {
    const fieldsText = fields
      .map((field) => `**${field.name}**\n${field.value}`)
      .join('\n\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsText));
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${new Date().toLocaleString('de-DE')}`)
  );

  await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch((error) => {
    logger.warn(`Konnte Log-Nachricht nicht senden: ${title}`, error?.message ?? error);
  });
}
