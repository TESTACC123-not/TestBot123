import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} from 'discord.js';
import { formatDuration, formatGermanDateTime, formatRelativeTime } from './time.js';

function fieldsToText(fields) {
  return fields.map((field) => `**${field.name}**\n${field.value}`).join('\n\n');
}

function footerLine(text) {
  return `-# ${text}`;
}

function chunkText(lines, maxLength = 3800, separator = '\n') {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}${separator}${line}` : line;
    if (candidate.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [''];
}

function buildTeamListChunks(teamRoles, guild, rows, maxLength = 3400) {
  const chunks = [];
  let current = '';
  let memberCount = 0;

  function pushLine(line) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength && current) {
      chunks.push(current);
      current = line;
      return true;
    }
    current = candidate;
    return false;
  }

  for (const teamRole of teamRoles) {
    if (!teamRole?.id) {
      continue;
    }

    const members = Array.from(
      guild.members.cache
        .filter((member) => member.roles.cache.has(teamRole.id))
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .values()
    );

    memberCount += members.length;

    pushLine(`### <@&${teamRole.id}> \`•\` ${members.length}`);

    if (!members.length) {
      pushLine('*Keine Inhaber*');
      continue;
    }

    const padWidth = String(members.length).length;
    members.forEach((member, index) => {
      const roblox = rows.get(member.id)?.roblox_name;
      const number = String(index + 1).padStart(Math.max(padWidth, 2), '0');
      const robloxLabel = roblox ? `\`${roblox}\`` : '*kein Roblox-Name*';
      const line = `\`${number}.\` <@${member.id}> — ${robloxLabel}`;

      const brokeChunk = pushLine(line);
      if (brokeChunk) {
        current = `### <@&${teamRole.id}> \`•\` ${members.length} *(Fortsetzung)*\n${current}`;
      }
    });
  }

  if (current) {
    chunks.push(current);
  }

  return { chunks: chunks.length ? chunks : [''], memberCount };
}

function header(title, subtitle = '') {
  return subtitle ? `**${title}**\n${subtitle}` : `**${title}**`;
}

function escapeCodeblockValue(value) {
  return String(value ?? '')
    .replace(/`/g, '\\`')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function renderTemplate(template, displayName) {
  if (!template) {
    return null;
  }

  const nameValue = (displayName ?? '').trim();
  const rendered = template
    .replace(/\(name\)/gi, nameValue || '(name)')
    .replace(/\{name\}/gi, nameValue || '{name}')
    .replace(/\[name\]/gi, nameValue || '[name]');

  return rendered.replace(/\s{2,}/g, ' ').trim();
}

export function buildSupportCasePayload(caseRecord, options = {}) {
  const { pingRoleIds: rawPingRoleIds, ...restOptions } = options;
  const pingRoleIds = Array.isArray(rawPingRoleIds) ? rawPingRoleIds.filter(Boolean) : [];
  const mentionText = pingRoleIds.length
    ? pingRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')
    : null;

  const statusText = caseRecord.status === 'closed'
    ? 'Geschlossen'
    : caseRecord.status === 'taken'
      ? 'Übernommen'
      : caseRecord.status === 'expired'
        ? 'Abgelaufen'
        : 'Offen';

  const fields = [
    { name: 'Benutzer', value: `<@${caseRecord.user_id}>`, inline: true },
    { name: 'Zeitpunkt', value: formatGermanDateTime(caseRecord.created_at), inline: true },
    { name: 'Status', value: statusText, inline: true }
  ];

  if (caseRecord.supporter_id) {
    fields.push({ name: 'Bearbeiter', value: `<@${caseRecord.supporter_id}>`, inline: true });
  }

  if (caseRecord.taken_at) {
    fields.push({ name: 'Übernommen', value: formatGermanDateTime(caseRecord.taken_at), inline: true });
  }

  if (caseRecord.ended_at) {
    fields.push({ name: 'Abschlusszeit', value: formatGermanDateTime(caseRecord.ended_at), inline: true });
    if (caseRecord.taken_at) {
      fields.push({
        name: 'Bearbeitungsdauer',
        value: formatDuration((caseRecord.ended_at - caseRecord.taken_at) / 1000),
        inline: true
      });
    }
  }

  const accentColor = caseRecord.status === 'closed' ? 0x2ecc71 : caseRecord.status === 'taken' ? 0xf1c40f : caseRecord.status === 'expired' ? 0x95a5a6 : 0x3498db;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  if (mentionText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(mentionText));
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Supportfall #${caseRecord.case_id.slice(0, 8)}**`),
      new TextDisplayBuilder().setContent('Ein Supportfall wurde automatisch erstellt und kann nun bearbeitet werden.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToText(fields)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        footerLine(`München RP | VC - Supportsystem · ${formatGermanDateTime(caseRecord.created_at)}`)
      )
    );

  const row = new ActionRowBuilder();

  if (caseRecord.status === 'open') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`support_take:${caseRecord.case_id}`)
        .setLabel('Übernehmen')
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (caseRecord.status === 'taken') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`support_end:${caseRecord.case_id}`)
        .setLabel('Schließen')
        .setStyle(ButtonStyle.Danger)
    );
  }

  if (row.components.length) {
    container.addActionRowComponents(row);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: mentionText
      ? { parse: [], roles: pingRoleIds }
      : { parse: [] },
    ...restOptions
  };
}

export function buildSupportLeaderboardPayload(rows, guild) {
  const container = new ContainerBuilder()
    .setAccentColor(0x8e44ad)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Support-Leaderboard**'),
      new TextDisplayBuilder().setContent(
        rows.length ? 'Die aktuelle Rangliste der Supporter.' : 'Noch keine abgeschlossenen Supportfälle vorhanden.'
      )
    );

  if (!rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(`Automatische Aktualisierung aktiv · ${new Date().toLocaleString('de-DE')}`)));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const fields = rows.slice(0, 10).map((row, index) => ({
    name: `Platz ${index + 1}`,
    value: `<@${row.userId}> | Fälle: **${row.caseCount}**`
  }));

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToText(fields)));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(`Automatische Aktualisierung aktiv · ${new Date().toLocaleString('de-DE')}`)));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildDutyPanelPayload(dutyConfig = {}) {
  const areas = dutyConfig.areas ?? {};
  const configuredAreas = ['support', 'highTeam', 'leitung']
    .map((key) => ({ key, ...(areas[key] ?? {}) }))
    .filter((area) => area.roleId);

  const rows = [];
  if (configuredAreas.length) {
    for (const area of configuredAreas) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`duty_on:${area.key}`)
            .setLabel(`On Duty · ${area.label}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`duty_off:${area.key}`)
            .setLabel(`Off Duty · ${area.label}`)
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }
  } else {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('duty_on').setLabel('On Duty').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('duty_off').setLabel('Off Duty').setStyle(ButtonStyle.Secondary)
      )
    );
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x1abc9c)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**On-Duty-System**'),
      new TextDisplayBuilder().setContent(
        'Schalte hier deinen Dienststatus für die einzelnen Bereiche um. Nur wer in einem Bereich On Duty ist, wird dort benachrichtigt und darf Anliegen übernehmen.'
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        fieldsToText(
          configuredAreas.length
            ? configuredAreas.map((area) => ({
                name: area.label,
                value: `On Duty = Dienstrolle „${area.label}“. Nur wer hier On Duty ist, wird benachrichtigt und darf bearbeiten.`
              }))
            : [
                { name: 'On Duty', value: 'Vergibt automatisch die On-Duty-Rolle.' },
                { name: 'Off Duty', value: 'Entfernt automatisch die On-Duty-Rolle.' }
              ]
        )
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine('Änderungen werden automatisch protokolliert.')));

  for (const row of rows) {
    container.addActionRowComponents(row);
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildVerifyPanelPayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_start')
      .setLabel('Verifizieren')
      .setStyle(ButtonStyle.Primary)
  );

  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Verify-System**'),
      new TextDisplayBuilder().setContent('Neue Mitglieder können sich hier mit einem Klick verifizieren, um die Bürgerrolle zu erhalten.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        fieldsToText([
          { name: 'Ablauf', value: 'Button klicken, direkt verifizieren lassen, fertig.' },
          { name: 'Hinweis', value: 'Bereits verifizierte Mitglieder können den Ablauf nicht erneut starten.' }
        ])
      )
    )
    .addActionRowComponents(row);

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildFlyPanelPayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fly_create')
      .setLabel('Antrag erstellen')
      .setStyle(ButtonStyle.Primary)
  );

  const container = new ContainerBuilder()
    .setAccentColor(0x9b59b6)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Fly- & Nametag-System**'),
      new TextDisplayBuilder().setContent('Hier kannst du einen Antrag für Fly oder einen Nametag erstellen.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        fieldsToText([
          { name: 'Voraussetzung', value: 'Ein Roblox-Name muss zuvor im Teamlisten-Kanal gespeichert worden sein.' },
          { name: 'Ablauf', value: 'Button klicken, Formular ausfüllen, Antrag wird automatisch weitergeleitet.' }
        ])
      )
    )
    .addActionRowComponents(row);

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildAbsencePanelPayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('absence_open')
      .setLabel('Abmelden')
      .setStyle(ButtonStyle.Primary)
  );

  const container = new ContainerBuilder()
    .setAccentColor(0xe67e22)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Abmeldesystem**'),
      new TextDisplayBuilder().setContent('Erstelle hier eine Abmeldung für einen gewünschten Zeitraum.')
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        fieldsToText([
          { name: 'Eingabe', value: 'Von, Bis und Grund werden im Formular abgefragt.' },
          { name: 'Automatik', value: 'Abmeldungen werden automatisch beendet, sobald die Endzeit erreicht ist.' }
        ])
      )
    )
    .addActionRowComponents(row);

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}


export function buildTeamListEmbeds({ guild, config, rows }) {
  const teamRoles = config.roles.teamRoles.filter((teamRole) => teamRole?.id);
  const timestamp = new Date().toLocaleString('de-DE');

  if (!teamRoles.length) {
    const container = new ContainerBuilder()
      .setAccentColor(0x3498db)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**📋 Teamliste**'),
        new TextDisplayBuilder().setContent('Keine Teamrollen konfiguriert oder keine Mitglieder gefunden.')
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(`Automatische Aktualisierung aktiv · ${timestamp}`)));

    return [{ flags: MessageFlags.IsComponentsV2, components: [container] }];
  }

  const { chunks, memberCount } = buildTeamListChunks(teamRoles, guild, rows);
  const totalParts = chunks.length;

  return chunks.map((chunk, index) => {
    const footerText = index === 0
      ? `Automatische Aktualisierung aktiv · ${memberCount} Teammitglieder`
      : 'Automatische Aktualisierung aktiv';

    const container = new ContainerBuilder()
      .setAccentColor(0x3498db)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**📋 Teamliste ${index + 1}/${totalParts}**`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk || 'Keine Einträge in diesem Teil der Teamliste gefunden.'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(`${footerText} · ${timestamp}`)));

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  });
}

export function buildFlyRequestPayload({
  requestRecord,
  reviewerName = null,
  reviewedAt = null,
  processingDuration = null,
  pingRoleId = null
}) {
  const discordMention = `<@${requestRecord.user_id}>`;
  const robloxMention = escapeCodeblockValue(requestRecord.roblox_name).replace(/^@+/, '');
  const flyDisplayName = escapeCodeblockValue(requestRecord.display_name);
  const flyNametag = escapeCodeblockValue(requestRecord.nametag);
  const roleMention = pingRoleId ? `<@&${pingRoleId}>` : null;

  const fields = [
    { name: 'Discord', value: discordMention },
    { name: 'Roblox-Name', value: `\`${requestRecord.roblox_name}\`` },
    { name: 'Anzeigename', value: `\`${requestRecord.display_name}\`` },
    { name: 'Teamrolle', value: requestRecord.team_role_id ? `<@&${requestRecord.team_role_id}>` : 'Nicht erkannt' },
    { name: 'Nametag', value: `\`${requestRecord.nametag}\`` },
    { name: 'Kopierbefehl 1', value: `\`\`\`text\nnametag set ${robloxMention} ${flyNametag}\n\`\`\`` },
    { name: 'Kopierbefehl 2', value: `\`\`\`text\nfly ${flyDisplayName}\n\`\`\`` },
    { name: 'Begründung', value: requestRecord.reason },
    { name: 'Erstellt am', value: formatGermanDateTime(requestRecord.created_at) }
  ];

  if (reviewerName || reviewedAt || processingDuration) {
    fields.push(
      { name: 'Bearbeitet von', value: reviewerName ? reviewerName : 'Unbekannt' },
      { name: 'Bearbeitet am', value: reviewedAt ? formatGermanDateTime(reviewedAt) : 'Unbekannt' },
      { name: 'Bearbeitungszeit', value: processingDuration ? formatDuration(processingDuration / 1000) : 'Unbekannt' }
    );
  }

  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`fly_reviewed:${requestRecord.request_id}`)
      .setLabel('Bearbeitet')
      .setStyle(ButtonStyle.Success)
      .setDisabled(requestRecord.status === 'reviewed')
  );

  const container = new ContainerBuilder()
    .setAccentColor(requestRecord.status === 'reviewed' ? 0x2ecc71 : 0xf39c12);

  if (roleMention) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(roleMention));
  }

  container
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Fly- / Nametag-Antrag**'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToText(fields)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine('München RP | VC - Antragsystem')))
    .addActionRowComponents(row);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: roleMention
      ? { parse: [], roles: [pingRoleId], users: [], repliedUser: false }
      : { parse: [] }
  };
}

export function buildActiveAbsencesEmbeds({ absences, guild }) {
  const timestamp = new Date().toLocaleString('de-DE');

  if (!absences.length) {
    const container = new ContainerBuilder()
      .setAccentColor(0xf1c40f)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Aktive Abmeldungen**'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Aktuell sind keine Abmeldungen aktiv.'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(`Automatische Aktualisierung aktiv · ${timestamp}`)));

    return [{ flags: MessageFlags.IsComponentsV2, components: [container] }];
  }

  const sections = absences.map((absence) => {
    const member = guild.members.cache.get(absence.user_id);
    const remaining = formatRelativeTime(absence.to_at);
    const label = member ? `<@${absence.user_id}>` : `<@${absence.user_id}>`;
    return header(
      label,
      [
        `• Von: \`${formatGermanDateTime(absence.from_at)}\``,
        `• Bis: \`${formatGermanDateTime(absence.to_at)}\``,
        `• Verbleibend: \`${remaining}\``,
        `• Grund: ${absence.reason}`
      ].join('\n')
    );
  });

  // Components V2 begrenzt den sichtbaren Text auf 4000 Zeichen PRO NACHRICHT, daher konservativ
  // auf 3400 Zeichen Inhalt pro Teil gechunkt und je Teil eine eigene Nachricht gebaut.
  const allChunks = chunkText(sections, 3400, '\n\n');
  const chunks = allChunks.slice(0, 10);
  const totalParts = chunks.length;
  const truncated = allChunks.length > chunks.length;

  return chunks.map((chunk, index) => {
    const isLast = index === totalParts - 1;
    const footerText = isLast && truncated
      ? 'Automatische Aktualisierung aktiv - weitere Abmeldungen wurden ausgelassen'
      : 'Automatische Aktualisierung aktiv';

    const container = new ContainerBuilder()
      .setAccentColor(0xf1c40f)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${index === 0 ? 'Aktive Abmeldungen' : `Aktive Abmeldungen ${index + 1}/${totalParts}`}**`)
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(`${footerText} · ${timestamp}`)));

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  });
}

export function buildAbsenceLogPayload(absenceRecord, type, extra = {}) {
  const fields = [
    { name: 'Discord', value: `<@${absenceRecord.user_id}>` },
    { name: 'Von', value: formatGermanDateTime(absenceRecord.from_at) },
    { name: 'Bis', value: formatGermanDateTime(absenceRecord.to_at) },
    { name: 'Grund', value: absenceRecord.reason }
  ];

  if (type === 'ended') {
    fields.push({ name: 'Ende', value: formatGermanDateTime(absenceRecord.ended_at ?? Date.now()) });
  }

  if (extra.reviewer) {
    fields.push({ name: 'Bearbeitet von', value: `<@${extra.reviewer}>` });
  }

  const timestampSource = type === 'ended' ? (absenceRecord.ended_at ?? Date.now()) : absenceRecord.created_at;

  const container = new ContainerBuilder()
    .setAccentColor(type === 'ended' ? 0x2ecc71 : 0xe67e22)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${type === 'ended' ? 'Abmeldung beendet' : 'Neue Abmeldung'}**`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToText(fields)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine(formatGermanDateTime(timestampSource))));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildVerificationModalQuestions(questions) {
  return questions.slice(0, 4).map((question, index) => ({
    customId: `verify_answer_${index + 1}`,
    label: question.question.slice(0, 45),
    placeholder: question.question.slice(0, 100),
    required: true
  }));
}

export function buildSupportCaseChannelMessage(caseRecord, options = {}) {
  return buildSupportCasePayload(caseRecord, options);
}

export function resolveTeamRoleForMember(member, config) {
  const orderedRoles = config.roles.teamRoles.filter((role) => role?.id);
  return orderedRoles.find((role) => member.roles.cache.has(role.id)) ?? null;
}

export function resolveNametagForMember(member, config, nametags, displayName = null) {
  const teamRole = resolveTeamRoleForMember(member, config);
  if (!teamRole) {
    return {
      teamRole: null,
      nametag: renderTemplate(nametags.default ?? null, displayName),
      template: nametags.default ?? null
    };
  }

  const mapping = nametags.mappings.find((entry) => entry.roleId && member.roles.cache.has(entry.roleId));
  const template = mapping?.nametag ?? nametags.default ?? null;
  return {
    teamRole,
    nametag: renderTemplate(template, displayName),
    template
  };
}

export { chunkText };