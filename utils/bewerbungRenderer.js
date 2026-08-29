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
        'Du möchtest Teil unseres Teams werden? Dann starte deine Bewerbung über den Button. Die Fragen werden dir per Direktnachricht gestellt.'
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
          .setEmoji('📝')
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
      new TextDisplayBuilder().setContent(`**Bewerbung – Frage ${index + 1}/${total}**`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(question));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Die fertige Bewerbung, die im Ergebnis-Kanal erscheint (mit Ping + Annehmen/Ablehnen).
 * record: der Bewerbungs-Datensatz (mit answers_json etc.)
 * questions: die Fragenliste (um die Antworten mit den Fragen zu verknüpfen).
 */
export function buildBewerbungResultPayload({ record, questions, reviewerName = null }) {
  let answers = [];
  try {
    answers = Array.isArray(record.answers_json)
      ? record.answers_json
      : JSON.parse(record.answers_json || '[]');
  } catch (_) {
    answers = [];
  }

  const qaLines = questions.map((question, index) => {
    const answer = answers[index];
    return `**${index + 1}. ${question}**\n${answer && String(answer).trim() ? String(answer).trim() : '–'}`;
  });

  const fields = [
    { name: 'Bewerber', value: `<@${record.user_id}>` },
    { name: 'Eingereicht am', value: formatGermanDateTime(record.created_at) },
    { name: 'Antworten', value: qaLines.join('\n\n') }
  ];

  const isReviewed = record.status === 'accepted' || record.status === 'rejected';
  const accent = record.status === 'accepted' ? 0x2ecc71 : record.status === 'rejected' ? 0xe74c3c : 0xf39c12;

  const container = new ContainerBuilder().setAccentColor(accent);
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
          `**Entscheidung: ${record.status === 'accepted' ? 'Angenommen ✅' : 'Abgelehnt ❌'}**`,
          `**Bearbeitet von:** ${reviewerName ? reviewerName : `<@${record.reviewer_id}>`}`,
          `**Grund:** ${record.review_reason ? record.review_reason : '–'}`
        ].join('\n')
      )
    );
  } else {
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bewerbung_accept:${record.application_id}`)
        .setLabel('Annehmen')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bewerbung_reject:${record.application_id}`)
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
