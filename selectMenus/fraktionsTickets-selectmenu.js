import { parseFraktionsTicketTopic } from '../utils/fraktionsTickets.js';
import { logger } from '../utils/logger.js';

function isValidChannel(channel) {
  return Boolean(parseFraktionsTicketTopic(channel?.topic));
}

async function handleAddUserSelect(interaction) {
  if (!isValidChannel(interaction.channel)) {
    return interaction.update({ content: '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.', components: [] });
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
    logger.error('Person konnte dem Fraktions-Ticket nicht hinzugefügt werden.', error);
    await interaction.update({ content: '❌ Beim Hinzufügen ist ein Fehler aufgetreten.', components: [] });
  }
}

async function handleRemoveUserSelect(interaction) {
  if (!isValidChannel(interaction.channel)) {
    return interaction.update({ content: '❌ Dieser Kanal ist kein gültiges Fraktions-Ticket.', components: [] });
  }

  const targetId = interaction.values[0];

  try {
    await interaction.channel.permissionOverwrites.delete(targetId);

    await interaction.update({ content: `✅ <@${targetId}> wurde aus dem Ticket entfernt.`, components: [] });
    await interaction.channel.send({ content: `➖ <@${targetId}> wurde von <@${interaction.user.id}> aus dem Ticket entfernt.` });
  } catch (error) {
    logger.error('Person konnte nicht aus dem Fraktions-Ticket entfernt werden.', error);
    await interaction.update({ content: '❌ Beim Entfernen ist ein Fehler aufgetreten.', components: [] });
  }
}

const handlers = [
  {
    name: 'fraktions_ticket_adduser_select',
    match: (customId) => customId === 'fraktions_ticket_adduser_select',
    execute: (interaction) => handleAddUserSelect(interaction)
  },
  {
    name: 'fraktions_ticket_removeuser_select',
    match: (customId) => customId === 'fraktions_ticket_removeuser_select',
    execute: (interaction) => handleRemoveUserSelect(interaction)
  }
];

export default handlers;
