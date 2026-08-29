import { MessageFlags, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { getTicketOwnerIdFromTopic } from '../utils/ticketHausKauf.js';
import { logger } from '../utils/logger.js';

function isValidChannel(channel) {
  return Boolean(getTicketOwnerIdFromTopic(channel?.topic));
}

async function handleAddUserSelect(interaction) {
  if (!isValidChannel(interaction.channel)) {
    return interaction.update({ content: '❌ Dieser Kanal ist kein gültiges Hauskauf-Ticket.', components: [] });
  }

  const targetId = interaction.values[0];

  try {
    await interaction.channel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    await interaction.update({ content: `✅ <@${targetId}> wurde zum Ticket hinzugefügt.`, components: [] });
    await interaction.channel.send({ content: `➕ <@${targetId}> wurde von <@${interaction.user.id}> zum Ticket hinzugefügt.` });
  } catch (error) {
    logger.error('Person konnte dem Hauskauf-Ticket nicht hinzugefügt werden.', error);
    await interaction.update({ content: '❌ Beim Hinzufügen ist ein Fehler aufgetreten.', components: [] });
  }
}

async function handleRemoveUserSelect(interaction) {
  if (!isValidChannel(interaction.channel)) {
    return interaction.update({ content: '❌ Dieser Kanal ist kein gültiges Hauskauf-Ticket.', components: [] });
  }

  const targetId = interaction.values[0];

  try {
    await interaction.channel.permissionOverwrites.delete(targetId);

    await interaction.update({ content: `✅ <@${targetId}> wurde aus dem Ticket entfernt.`, components: [] });
    await interaction.channel.send({ content: `➖ <@${targetId}> wurde von <@${interaction.user.id}> aus dem Ticket entfernt.` });
  } catch (error) {
    logger.error('Person konnte nicht aus dem Hauskauf-Ticket entfernt werden.', error);
    await interaction.update({ content: '❌ Beim Entfernen ist ein Fehler aufgetreten.', components: [] });
  }
}

const handlers = [
  {
    name: 'ticket_hauskauf_adduser_select',
    match: (customId) => customId === 'ticket_hauskauf_adduser_select',
    execute: (interaction) => handleAddUserSelect(interaction)
  },
  {
    name: 'ticket_hauskauf_removeuser_select',
    match: (customId) => customId === 'ticket_hauskauf_removeuser_select',
    execute: (interaction) => handleRemoveUserSelect(interaction)
  }
];

export default handlers;