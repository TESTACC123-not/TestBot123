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
import { formatGermanDateTime } from './time.js';

function footerLine(text) {
  return `-# ${text}`;
}

function fieldsToText(fields) {
  return fields.map((field) => `**${field.name}**\n${field.value}`).join('\n\n');
}

/**
 * Das Bewerbungs-Panel: ein kurzer Einladungstext mit dem "Bewerben"-Button.
 * Wird in dem Kanal gepostet, der unter bewerbung.panelChannelId steht.
 */
export function buildBewerbungPanelPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(0x3498db)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Bewerbung**'),
      new TextDisplayBuilder().setContent(
        'Du möchtest Teil unseres Teams werden? Dann starte deine Bewerbung über den Button. Die Fragen werden dir per Direktnachricht gestellt.\n\nHast du bereits eine offene oder laufende Bewerbung, kannst du sie jederzeit mit „Bewerbung zurückziehen“ beenden.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('bewerbung_start')
          .setLabel('Bewerben')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId('bewerbung_withdraw')
          .setLabel('Bewerbung zurückziehen')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⏹️')
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine(`München RP | VC - Bewerbungssystem`))
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Die Fragen, die per DM nacheinander gestellt werden.
 * question: die Frage, index: 0-basiert, total: Anzahl der Fragen.
 */
export function buildBewerbungDmQuestion(question, index, total) {
  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`📝 **Bewerbung – Frage ${index + 1}/${total}**`),
      new TextDisplayBuilder().setContent(
        `**${question}**`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine(`Beantworte die Frage einfach als Nachricht in diesem Chat.`))
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('bewerbung_cancel')
          .setLabel('Bewerbung abbrechen')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⏹️')
      )
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Bestätigung per DM, nachdem alle Fragen beantwortet wurden.
 */
export function buildBewerbungSubmittedPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('✅ **Bewerbung erfolgreich abgesendet**'),
      new TextDisplayBuilder().setContent(
        'Danke für deine Bewerbung! Sie wurde übermittelt und wird nun geprüft. Du erhältst hier per Direktnachricht Bescheid, sobald eine Entscheidung getroffen wurde.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine('München RP | VC - Bewerbungssystem'))
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Bestätigung per DM, dass die Bewerbung abgebrochen wurde.
 */
export function buildBewerbungCancelledPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(0xe74c3c)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('⏹️ **Bewerbung abgebrochen**'),
      new TextDisplayBuilder().setContent(
        'Deine Bewerbung wurde abgebrochen und verworfen. Falls du dich später erneut bewerben möchtest, drücke einfach wieder auf den „Bewerben“-Button im Bewerbungs-Kanal.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine('München RP | VC - Bewerbungssystem'))
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Entscheidung per DM an den Bewerber (Annahme oder Ablehnung).
 */
export function buildBewerbungDecisionDmPayload({ status, reason, rejectDurationHours }) {
  const accepted = status === 'accepted';
  const container = new ContainerBuilder()
    .setAccentColor(accepted ? 0x2ecc71 : 0xe74c3c)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        accepted ? '🎉 **Bewerbung angenommen**' : '❌ **Bewerbung abgelehnt**'
      ),
      new TextDisplayBuilder().setContent(
        accepted
          ? 'Herzlichen Glückwunsch, du bist jetzt Teil unseres Teams!'
          : 'Leider wurde deine Bewerbung nicht angenommen.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**Grund:** ${reason || '–'}`,
          accepted
            ? 'Deine Team-Rolle wurde dir zugewiesen.'
            : `Die Ablehnungs-Rolle wird nach ${rejectDurationHours} Stunden automatisch wieder entfernt.`
        ].join('\n\n')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine('München RP | VC - Bewerbungssystem'))
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Die fertige Bewerbung, die im Ergebnis-Kanal erscheint (mit Ping + Annehmen/Ablehnen).
 * record: der Bewerbungs-Datensatz (mit answers_json etc.)
 * questions: die Fragenliste (um die Antworten mit den Fragen zu verknüpfen).
 * pingRoleId: optionale Rolle, die bei einer neuen Bewerbung gepinnt wird.
 */
export function buildBewerbungResultPayload({ record, questions, reviewerName = null, pingRoleId = null }) {
  // record kann ein DB-Datensatz (snake_case) oder ein frisches Objekt (camelCase) sein.
  const applicationId = record.application_id ?? record.applicationId;
  const userId = record.user_id ?? record.userId;
  const createdAt = record.created_at ?? record.createdAt;
  const status = record.status;
  const reviewerId = record.reviewer_id ?? record.reviewerId;
  const reviewReason = record.review_reason ?? record.reviewReason;

  let answers = [];
  try {
    const rawAnswers = record.answers_json ?? record.answers;
    answers = Array.isArray(rawAnswers) ? rawAnswers : JSON.parse(rawAnswers || '[]');
  } catch (_) {
    answers = [];
  }

  const qaLines = questions.map((question, index) => {
    const answer = answers[index];
    return `**${index + 1}. ${question}**\n${answer && String(answer).trim() ? String(answer).trim() : '–'}`;
  });

  const fields = [
    { name: 'Bewerber', value: userId ? `<@${userId}>` : '–' },
    { name: 'Eingereicht am', value: createdAt ? formatGermanDateTime(createdAt) : '–' },
    { name: 'Antworten', value: qaLines.join('\n\n') }
  ];

  const isReviewed = status === 'accepted' || status === 'rejected';
  const accent = status === 'accepted' ? 0x2ecc71 : status === 'rejected' ? 0xe74c3c : 0xf39c12;

  const container = new ContainerBuilder().setAccentColor(accent);
  if (pingRoleId) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`<@&${pingRoleId}> – eine neue Bewerbung ist da!`)
    );
  }
  container
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Neue Bewerbung**'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsToText(fields)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerLine('München RP | VC - Bewerbungssystem'))
    );

  if (isReviewed) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '',
          `**Entscheidung: ${status === 'accepted' ? 'Angenommen ✅' : 'Abgelehnt ❌'}**`,
          `**Bearbeitet von:** ${reviewerName ? reviewerName : reviewerId ? `<@${reviewerId}>` : '–'}`,
          `**Grund:** ${reviewReason ? reviewReason : '–'}`
        ].join('\n')
      )
    );
  } else {
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bewerbung_accept:${applicationId}`)
        .setLabel('Annehmen')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bewerbung_reject:${applicationId}`)
        .setLabel('Ablehnen')
        .setStyle(ButtonStyle.Danger)
    );
    container.addActionRowComponents(row);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}
