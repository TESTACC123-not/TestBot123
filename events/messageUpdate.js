import { logger } from '../utils/logger.js';

function getChannelLabel(message) {
  return message.channel?.isDMBased?.() ? 'DM' : `#${message.channel?.name || message.channelId}`;
}

function preview(message) {
  const content = String(message.content || '').replace(/\s+/g, ' ').trim();
  const componentText = message.components?.length ? `components=${message.components.length}` : '';
  const embedText = message.embeds?.length ? `embeds=${message.embeds.length}` : '';
  return [content ? `"${content.slice(0, 300)}"` : '', componentText, embedText].filter(Boolean).join(' | ') || '(ohne Text)';
}

export default {
  name: 'messageUpdate',
  once: false,
  async execute(oldMessage, newMessage) {
    if (!newMessage?.author?.bot) return;
    logger.info(`[BOT][UPDATE] ${getChannelLabel(newMessage)} | ${newMessage.author.tag} (${newMessage.author.id}) | ${preview(newMessage)}`);
  }
};