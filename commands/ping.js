import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Zeigt die Bot-Latenz an.'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pong!', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! Latenz: ${latency} ms`);
  }
};
