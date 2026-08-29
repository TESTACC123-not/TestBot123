import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import path from 'node:path';
import {
  buildRealEstateEmbed,
  DEFAULT_REAL_ESTATES,
  REAL_ESTATE_STATUS
} from '../utils/realEstate.js';

const STATUS_LABELS = {
  [REAL_ESTATE_STATUS.available]: 'Verfügbar',
  [REAL_ESTATE_STATUS.reserved]: 'Reserviert',
  [REAL_ESTATE_STATUS.sold]: 'Verkauft',
  [REAL_ESTATE_STATUS.unavailable]: 'Nicht verfügbar'
};

function ensureDefaults(runtime) {
  runtime.db.ensureRealEstateDefaults(
    runtime.config.guildId,
    DEFAULT_REAL_ESTATES.map((house) => ({ id: house.id, label: house.name, priceLabel: house.preis }))
  );
}

function resolveHouseChannel(interaction, runtime) {
  const channelId = runtime.config.panels?.realEstate?.channelId;
  const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
  if (!channelId) {
    return { channel: null, error: '❌ Keine panels.realEstate.channelId in der config.json gesetzt!' };
  }
  if (!channel) {
    return { channel: null, error: `❌ Kanal mit ID ${channelId} nicht gefunden! Bitte panels.realEstate.channelId in der config.json prüfen.` };
  }
  if (!channel.isTextBased()) {
    return { channel: null, error: '❌ Der Kanal ist kein Textkanal!' };
  }
  return { channel, error: null };
}

async function publishList(interaction, runtime) {
  const { channel, error } = resolveHouseChannel(interaction, runtime);
  if (!channel) {
    return { ok: false, content: error };
  }

  ensureDefaults(runtime);
  const rows = runtime.db.listRealEstates(runtime.config.guildId);
  const imageFilePath = path.join(runtime.rootDir, 'assets', 'immobilien-karte.png');
  const payload = buildRealEstateEmbed(rows, { imageFilePath });

  const messages = await channel.messages.fetch({ limit: 10 });
  const botMessage = messages.find((msg) => msg.author.id === interaction.client.user.id);

  if (botMessage) {
    await botMessage.edit(payload);
  } else {
    await channel.send(payload);
  }

  return { ok: true, content: `✅ Immobilienliste wurde in ${channel} aktualisiert!` };
}

function findHouse(runtime, houseId) {
  ensureDefaults(runtime);
  return runtime.db.getRealEstate(runtime.config.guildId, houseId) ?? null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('immobilien')
    .setDescription('Verwaltet die Immobilienliste.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('posten')
      .setDescription('Postet oder aktualisiert die Immobilienliste in den festgelegten Kanal.')
    )
    .addSubcommand((subcommand) => subcommand
      .setName('reservieren')
      .setDescription('Setzt ein Haus auf "Reserviert" und ordnet es einem Nutzer zu.')
      .addIntegerOption((option) => option
        .setName('haus')
        .setDescription('Nummer des Hauses')
        .setRequired(true)
        .setMinValue(1)
      )
      .addUserOption((option) => option
        .setName('nutzer')
        .setDescription('Nutzer, für den das Haus reserviert wird')
        .setRequired(true)
      )
      .addStringOption((option) => option
        .setName('notiz')
        .setDescription('Optionale Notiz (z. B. Anzahlung geleistet)')
      )
    )
    .addSubcommand((subcommand) => subcommand
      .setName('verkaufen')
      .setDescription('Setzt ein Haus auf "Verkauft" und trägt den Käufer ein.')
      .addIntegerOption((option) => option
        .setName('haus')
        .setDescription('Nummer des Hauses')
        .setRequired(true)
        .setMinValue(1)
      )
      .addUserOption((option) => option
        .setName('nutzer')
        .setDescription('Käufer des Hauses')
        .setRequired(true)
      )
    )
    .addSubcommand((subcommand) => subcommand
      .setName('nichtverfuegbar')
      .setDescription('Markiert ein Haus als "Nicht verfügbar".')
      .addIntegerOption((option) => option
        .setName('haus')
        .setDescription('Nummer des Hauses')
        .setRequired(true)
        .setMinValue(1)
      )
    )
    .addSubcommand((subcommand) => subcommand
      .setName('freigeben')
      .setDescription('Setzt ein Haus wieder auf "Verfügbar" (reserviert/verkauft wird entfernt).')
      .addIntegerOption((option) => option
        .setName('haus')
        .setDescription('Nummer des Hauses')
        .setRequired(true)
        .setMinValue(1)
      )
    )
    .addSubcommand((subcommand) => subcommand
      .setName('preis')
      .setDescription('Aktualisiert den Preis eines Hauses.')
      .addIntegerOption((option) => option
        .setName('haus')
        .setDescription('Nummer des Hauses')
        .setRequired(true)
        .setMinValue(1)
      )
      .addStringOption((option) => option
        .setName('preis')
        .setDescription('Neuer Preis, z. B. 145.000')
        .setRequired(true)
      )
    ),

  async execute(interaction, runtime) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const subcommand = interaction.options.getSubcommand();
    const houseId = interaction.options.getInteger('haus');
    const house = houseId ? findHouse(runtime, houseId) : null;

    if (house && (subcommand === 'reservieren' || subcommand === 'verkaufen' || subcommand === 'nichtverfuegbar' || subcommand === 'freigeben')) {
      const subToStatus = {
        reservieren: REAL_ESTATE_STATUS.reserved,
        verkaufen: REAL_ESTATE_STATUS.sold,
        nichtverfuegbar: REAL_ESTATE_STATUS.unavailable,
        freigeben: REAL_ESTATE_STATUS.available
      };
      const status = subToStatus[subcommand];
      const isFree = subcommand === 'freigeben';
      const statusNote = isFree ? null : (interaction.options.getString('notiz') ?? null);
      const targetUser = (subcommand === 'reservieren' || subcommand === 'verkaufen')
        ? interaction.options.getUser('nutzer')
        : null;
      const userIds = targetUser ? [targetUser.id] : [];

      runtime.db.updateRealEstateStatus(runtime.config.guildId, houseId, {
        status,
        userIds,
        note: statusNote,
        updatedBy: interaction.user.id,
        updatedAt: Date.now()
      });

      const result = await publishList(interaction, runtime);
      if (!result.ok) {
        return interaction.editReply({ content: result.content });
      }

      const label = STATUS_LABELS[status];
      const mention = userIds.length ? ` <@${userIds[0]}>` : '';
      return interaction.editReply({
        content: `✅ Haus **${house.label}** (Nr. ${houseId}) wurde als "${label}" gesetzt${mention}. Die Liste wurde aktualisiert.`
      });
    }

    if (house && subcommand === 'preis') {
      const priceLabel = `\u20AC ${interaction.options.getString('preis').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
      runtime.db.updateRealEstatePrice(runtime.config.guildId, houseId, priceLabel, interaction.user.id);

      const result = await publishList(interaction, runtime);
      if (!result.ok) {
        return interaction.editReply({ content: result.content });
      }

      return interaction.editReply({ content: `✅ Preis von Haus **${house.label}** wurde auf \`${priceLabel}\` gesetzt.` });
    }

    if (houseId && !house) {
      return interaction.editReply({ content: `❌ Haus Nr. ${houseId} wurde nicht gefunden.` });
    }

    if (subcommand === 'posten') {
      try {
        const result = await publishList(interaction, runtime);
        return interaction.editReply({ content: result.content });
      } catch (error) {
        return interaction.editReply({ content: '❌ Fehler beim Verwalten der Liste!' });
      }
    }

    return interaction.editReply({ content: '❌ Unbekanntes Subcommand!' });
  }
};