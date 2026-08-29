import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder
} from 'discord.js';

import { logger } from '../utils/logger.js';

/* ============================================================
 * HELPERS
 * ============================================================ */

function hasAnyRole(member, roleIds = []) {
  return roleIds.some(
    (roleId) => roleId && member.roles.cache.has(roleId)
  );
}

function isAdmin(member) {
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function isTeamMember(member, runtime) {
  return (
    isAdmin(member) ||
    hasAnyRole(
      member,
      runtime.config.roles.teamRoles.map((role) => role.id)
    )
  );
}

function getMention(user) {
  return user ? `<@${user.id}>` : null;
}

function resolveOptionalSignatory(interaction, optionName) {
  try {
    const user = interaction.options.getUser(optionName);
    if (user) return getMention(user);
  } catch (_) {}

  try {
    const text = interaction.options.getString(optionName)?.trim();
    if (!text) return null;

    const mentionMatch = text.match(/^<@!?(\d+)>$/);
    if (mentionMatch) return `<@${mentionMatch[1]}>`;

    const idMatch = text.match(/^\d{15,20}$/);
    if (idMatch) return `<@${text}>`;

    return text;
  } catch (_) {}

  return null;
}

function buildSignatureLines(interaction) {
  const lines = [`**Unterzeichnet:** ${getMention(interaction.user)}`];

  for (let i = 1; i <= 5; i++) {
    const signer = resolveOptionalSignatory(interaction, `nebenunterschrift${i}`);
    if (signer) lines.push(`**Nebenunterschrift ${i}:** ${signer}`);
  }

  return lines;
}

async function resolveTeamUpdateChannel(interaction, runtime) {
  const channelId = runtime.config.teamUpdate?.channelId;
  if (!channelId) return null;

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

/* ============================================================
 * ROLE CHANGES
 * ============================================================ */

async function applyRoleChanges(interaction, runtime, templateName) {
  const targetUser = interaction.options.getUser('wer');
  if (!targetUser) return { changed: false, note: null };

  const member = await interaction.guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  if (!member) {
    return {
      changed: false,
      note: `Mitglied ${targetUser} konnte nicht gefunden werden.`
    };
  }

  try {
    if (templateName === 'teamwarn' || templateName === 'temp-teamwarn') {
      const warnRoleIds = runtime.config.teamUpdate?.warnRoleIds ?? [];
      const removedRoleIds = warnRoleIds.filter((id) =>
        member.roles.cache.has(id)
      );

      if (removedRoleIds.length > 0) {
        await member.roles.remove(removedRoleIds);
      }

      return {
        changed: removedRoleIds.length > 0,
        note:
          removedRoleIds.length > 0
            ? `${targetUser}: Teamwarn-Rollen entfernt`
            : null
      };
    }

    if (templateName === 'neuer-teamler') {
      const role = interaction.options.getRole('zu');
      if (!role) return { changed: false, note: null };

      await member.roles.add(role.id);
      return {
        changed: true,
        note: `${targetUser} hat jetzt die Rolle ${role}.`
      };
    }

    if (templateName === 'uprank' || templateName === 'downrank') {
      const fromRole = interaction.options.getRole('von');
      const toRole = interaction.options.getRole('zu');
      const actions = [];

      if (fromRole) {
        await member.roles.remove(fromRole.id).catch(() => null);
        actions.push(`entfernt ${fromRole}`);
      }
      if (toRole) {
        await member.roles.add(toRole.id);
        actions.push(`gegeben ${toRole}`);
      }

      return {
        changed: actions.length > 0,
        note:
          actions.length > 0
            ? `${targetUser}: ${actions.join(' und ')}`
            : null
      };
    }

    if (templateName === 'nebenrolle-uprank') {
      const role = interaction.options.getRole('auf');
      if (!role) return { changed: false, note: null };

      await member.roles.add(role.id);
      return {
        changed: true,
        note: `${targetUser} hat jetzt die Rolle ${role}.`
      };
    }

    if (templateName === 'teamkick') {
      const fromRole = interaction.options.getRole('von');
      if (fromRole) {
        await member.roles.remove(fromRole.id);
        return {
          changed: true,
          note: `${targetUser} wurde aus ${fromRole} entfernt.`
        };
      }
    }
  } catch (error) {
    logger.warn('Rollenänderung fehlgeschlagen.', error?.message ?? error);
    return {
      changed: false,
      note: 'Die Rollenänderung konnte nicht vollständig ausgeführt werden.'
    };
  }

  return { changed: false, note: null };
}

/* ============================================================
 * TEMPLATE CONTENT
 * ============================================================ */

function buildTemplateContent(interaction, templateName) {
  const wer = interaction.options.getUser('wer');
  const grund = interaction.options.getString('grund')?.trim();
  const signatureLines = buildSignatureLines(interaction);
  const userMention = getMention(wer);

  switch (templateName) {
    case 'temp-teamwarn': {
      const dauer = interaction.options.getString('dauer')?.trim();
      return {
        color: 0xF1C40F,
        heading: '⚠️ Temp Teamwarn',
        lines: [
          `**Wer:** ${userMention}`,
          `**Grund:** ${grund}`,
          `**Dauer:** ${dauer}`
        ],
        signatureLines
      };
    }

    case 'teamwarn':
      return {
        color: 0xF1C40F,
        heading: '⚠️ Teamwarn',
        lines: [
          `**Wer:** ${userMention}`,
          `**Grund:** ${grund}`
        ],
        signatureLines
      };

    case 'neuer-teamler': {
      const zu = interaction.options.getRole('zu');
      return {
        color: 0x2ECC71,
        heading: '🎉 Neuer Teamler',
        lines: [
          `**Wer:** ${userMention}`,
          `**Zu:** ${zu ? `<@&${zu.id}>` : 'Unbekannt'}`,
          `**Grund:** ${grund}`
        ],
        signatureLines
      };
    }

    case 'uprank': {
      const von = interaction.options.getRole('von');
      const zu = interaction.options.getRole('zu');
      return {
        color: 0x2ECC71,
        heading: '⬆️ Uprank',
        lines: [
          `**Wer:** ${userMention}`,
          `**Von:** ${von ? `<@&${von.id}>` : 'Unbekannt'}`,
          `**Zu:** ${zu ? `<@&${zu.id}>` : 'Unbekannt'}`,
          `**Grund:** ${grund}`
        ],
        signatureLines
      };
    }

    case 'nebenrolle-uprank': {
      const auf = interaction.options.getRole('auf');
      return {
        color: 0x2ECC71,
        heading: '⬆️ Nebenrolle Uprank',
        lines: [
          `**Wer:** ${userMention}`,
          `**Auf:** ${auf ? `<@&${auf.id}>` : 'Unbekannt'}`,
          `**Grund:** ${grund}`
        ],
        signatureLines
      };
    }

    case 'downrank': {
      const von = interaction.options.getRole('von');
      const zu = interaction.options.getRole('zu');
      return {
        color: 0xE67E22,
        heading: '⬇️ Downrank',
        lines: [
          `**Wer:** ${userMention}`,
          `**Von:** ${von ? `<@&${von.id}>` : 'Unbekannt'}`,
          `**Zu:** ${zu ? `<@&${zu.id}>` : 'Unbekannt'}`,
          `**Grund:** ${grund}`
        ],
        signatureLines
      };
    }

    case 'teamkick': {
      const von = interaction.options.getRole('von');
      return {
        color: 0xE74C3C,
        heading: '⛔ Teamkick',
        lines: [
          `**Wer:** ${userMention}`,
          `**Von:** ${von ? `<@&${von.id}>` : 'Unbekannt'}`,
          `**Grund:** ${grund}`
        ],
        signatureLines
      };
    }

    default:
      return null;
  }
}

/* ============================================================
 * COMPONENTS V2 BUILDER — MIT GARANTIERTEM PING
 * ============================================================
 *
 * WICHTIG (Discord Components V2 Reference):
 * - flag IS_COMPONENTS_V2 (1 << 15) wird benötigt
 * - Mentions in TextDisplay pingen NUR, wenn sie in
 *   allowed_mentions erlaubt sind
 * - Rollen-Mentions pingen NUR, wenn die Rolle
 *   "mentionable" ist UND die ID in allowed_mentions.roles steht
 * ============================================================ */

function buildTemplateMessage(interaction, runtime, templateName) {
  const template = buildTemplateContent(interaction, templateName);
  if (!template) return null;

  const teamPingRoleId = runtime.config.teamUpdate?.teamPingRoleId;

  const container = new ContainerBuilder()
    .setAccentColor(template.color);

  /* HEADING */
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${template.heading}`)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small)
  );

  /* MAIN INFO */
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(template.lines.join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small)
  );

  /* SIGNATURES */
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(template.signatureLines.join('\n'))
  );

  /* TEAM PING — IMMER */
  if (teamPingRoleId) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`<@&${teamPingRoleId}>`)
    );
  }

  /*
   * allowed_mentions:
   * - parse: []              → blockiert @everyone, @here, users
   * - roles: [teamPingRoleId] → erlaubt explizit das Pingen
   *                              genau dieser Rolle
   *
   * NUR wenn die Rolle in Discord selbst "mentionable" = ✅
   * ist UND ihre ID hier in `roles` steht, wird auch wirklich
   * gepingt.
   */
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: teamPingRoleId
      ? {
          parse: [],
          roles: [teamPingRoleId],
          users: []
        }
      : {
          parse: [],
          users: []
        }
  };
}

/* ============================================================
 * SEND UPDATE
 * ============================================================ */

async function sendUpdate(interaction, runtime, templateName) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isTeamMember(interaction.member, runtime)) {
    return interaction.editReply({
      content: 'Du bist nicht berechtigt, diesen Eintrag zu erstellen.'
    });
  }

  const targetChannel = await resolveTeamUpdateChannel(interaction, runtime);
  if (!targetChannel) {
    return interaction.editReply({
      content:
        'Der feste Kanal dafür konnte nicht gefunden werden oder ist kein Textkanal. Bitte teamUpdate.channelId in der config.json prüfen.'
    });
  }

  /*
   * WICHTIG: Wenn die Rolle NICHT mentionable ist,
   * machen wir sie für den Ping automatisch mentionable,
   * senden die Nachricht und setzen den Status zurück.
   * So funktioniert der Ping IMMER.
   */
  const teamPingRoleId = runtime.config.teamUpdate?.teamPingRoleId;
  let roleWasMadeMentionable = false;
  let roleBackupMentionable = null;

  if (teamPingRoleId) {
    try {
      const role = await interaction.guild.roles.fetch(teamPingRoleId);
      if (role && !role.mentionable) {
        roleBackupMentionable = role.mentionable;
        await role.setMentionable(true, 'Team-Update Ping');
        roleWasMadeMentionable = true;
      }
    } catch (error) {
      logger.warn(
        'Konnte Rolle nicht auf mentionable setzen.',
        error?.message ?? error
      );
    }
  }

  const roleChange = await applyRoleChanges(interaction, runtime, templateName);

  const message = buildTemplateMessage(interaction, runtime, templateName);
  if (!message) {
    if (roleWasMadeMentionable) {
      const role = await interaction.guild.roles.fetch(teamPingRoleId).catch(() => null);
      if (role) await role.setMentionable(roleBackupMentionable, 'Team-Update Ping Reset').catch(() => null);
    }
    return interaction.editReply({
      content: 'Diese Vorlage ist unbekannt.'
    });
  }

  try {
    await targetChannel.send(message);
  } catch (error) {
    logger.warn('Eintrag konnte nicht gesendet werden.', error?.message ?? error);
    if (roleWasMadeMentionable) {
      const role = await interaction.guild.roles.fetch(teamPingRoleId).catch(() => null);
      if (role) await role.setMentionable(roleBackupMentionable, 'Team-Update Ping Reset').catch(() => null);
    }
    return interaction.editReply({
      content:
        'Der Eintrag konnte nicht gesendet werden. Bitte prüfe die Kanal-Berechtigungen.'
    });
  }

  /*
   * mentionable-Status nach kurzer Zeit zurücksetzen,
   * damit die Rolle nicht dauerhaft pingbar ist.
   */
  if (roleWasMadeMentionable) {
    setTimeout(async () => {
      try {
        const role = await interaction.guild.roles.fetch(teamPingRoleId).catch(() => null);
        if (role) {
          await role.setMentionable(
            roleBackupMentionable ?? false,
            'Team-Update Ping Reset'
          );
        }
      } catch (error) {
        logger.warn(
          'Konnte mentionable-Status nicht zurücksetzen.',
          error?.message ?? error
        );
      }
    }, 1500);
  }

  const parts = ['Eintrag wurde veröffentlicht.'];
  if (roleChange.note) parts.push(roleChange.note);

  return interaction.editReply({
    content: `${parts.join(' ')} Kanal: ${targetChannel}.`
  });
}

/* ============================================================
 * SIGNATURE OPTION BUILDER
 * ============================================================ */

const signatureOptions = (builder) =>
  builder
    .addUserOption((o) =>
      o.setName('nebenunterschrift1')
       .setDescription('Optional: Zusätzliche Unterschrift 1.')
    )
    .addUserOption((o) =>
      o.setName('nebenunterschrift2')
       .setDescription('Optional: Zusätzliche Unterschrift 2.')
    )
    .addUserOption((o) =>
      o.setName('nebenunterschrift3')
       .setDescription('Optional: Zusätzliche Unterschrift 3.')
    )
    .addUserOption((o) =>
      o.setName('nebenunterschrift4')
       .setDescription('Optional: Zusätzliche Unterschrift 4.')
    )
    .addUserOption((o) =>
      o.setName('nebenunterschrift5')
       .setDescription('Optional: Zusätzliche Unterschrift 5.')
    );

/* ============================================================
 * COMMAND DATA
 * ============================================================ */

export default {
  data: new SlashCommandBuilder()
    .setName('team-update')
    .setDescription('Erstellt und veröffentlicht Team-Einträge als fertige Vorlagen.')
    .setDMPermission(false)

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('temp-teamwarn')
          .setDescription('Erstellt eine temporäre Teamwarnung.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund der Teamwarnung.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('dauer').setDescription('Die Dauer der Warnung.').setRequired(true)
          )
      )
    )

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('teamwarn')
          .setDescription('Erstellt eine normale Teamwarnung.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund der Teamwarnung.').setRequired(true)
          )
      )
    )

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('neuer-teamler')
          .setDescription('Erstellt einen Eintrag für einen neuen Teamler.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('zu').setDescription('Die Zielrolle.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund für den Eintrag.').setRequired(true)
          )
      )
    )

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('uprank')
          .setDescription('Erstellt einen Uprank-Eintrag.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('von').setDescription('Die alte Rolle.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('zu').setDescription('Die neue Rolle.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund für den Uprank.').setRequired(true)
          )
      )
    )

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('nebenrolle-uprank')
          .setDescription('Erstellt einen Uprank für eine Nebenrolle.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('auf').setDescription('Die neue Nebenrolle.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund für den Uprank.').setRequired(true)
          )
      )
    )

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('downrank')
          .setDescription('Erstellt einen Downrank-Eintrag.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('von').setDescription('Die alte Rolle.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('zu').setDescription('Die neue Rolle.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund für den Downrank.').setRequired(true)
          )
      )
    )

    .addSubcommand((sub) =>
      signatureOptions(
        sub
          .setName('teamkick')
          .setDescription('Erstellt einen Teamkick-Eintrag.')
          .addUserOption((o) =>
            o.setName('wer').setDescription('Die betroffene Person.').setRequired(true)
          )
          .addRoleOption((o) =>
            o.setName('von').setDescription('Die Rolle, die entfernt werden soll.').setRequired(true)
          )
          .addStringOption((o) =>
            o.setName('grund').setDescription('Der Grund für den Teamkick.').setRequired(true)
          )
      )
    ),

  async execute(interaction, runtime) {
    const subcommand = interaction.options.getSubcommand();
    return sendUpdate(interaction, runtime, subcommand);
  }
};
