function cleanQuestion(message) {
  const botId = message.client.user?.id;
  const withoutMention = String(message.content ?? '')
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();

  return withoutMention.toLocaleLowerCase('de-DE');
}

function channelMention(channelId) {
  return channelId ? `<#${channelId}>` : 'nicht konfiguriert';
}

function listRoles(roles = []) {
  const labels = roles.map((role) => role.label).filter(Boolean);
  if (!labels.length) return 'Keine Teamrollen sind konfiguriert.';
  return labels.join(', ');
}

/**
 * Lokaler Assistent, dessen Wissen ausschließlich aus der Bot-Konfiguration stammt.
 * Er sendet niemals Token, Datenbankpfade oder andere Geheimnisse.
 */
export async function answerFromConfigKnowledge(message, runtime) {
  if (runtime.config.aiAssistant?.enabled === false) {
    return false;
  }

  const question = cleanQuestion(message);
  if (!question) {
    return false;
  }

  const config = runtime.config;
  let answer = '';

  if (question.includes('code')) {
    answer = config.gameServerCode
      ? `Der aktuelle Ingame-Server-Code lautet: \`${config.gameServerCode}\`.`
      : 'Der Ingame-Server-Code ist noch nicht konfiguriert.';
  } else if (question.includes('support') || question.includes('hilfe')) {
    answer = `Für Support nutze bitte ${channelMention(config.channels.supportChannelId)}. Das Support-Team übernimmt dein Anliegen dort.`;
  } else if (question.includes('bewerbung') || question.includes('bewerben')) {
    answer = `Das Bewerbungs-Panel findest du in ${channelMention(config.bewerbung.panelChannelId)}.`;
  } else if (question.includes('waffenschein')) {
    answer = `Das Waffenschein-Panel findest du in ${channelMention(config.waffenschein.panelChannelId)}.`;
  } else if (question.includes('fraktion')) {
    answer = `Fraktions-Anfragen erstellst du in ${channelMention(config.fraktionsTickets.panelChannelId)}.`;
  } else if (question.includes('abmeldung') || question.includes('abmelden')) {
    answer = `Das Abmeldungs-Panel findest du in ${channelMention(config.channels.absencePanelChannelId)}.`;
  } else if (question.includes('status') || question.includes('rp') || question.includes('server')) {
    answer = `Server-Status und RP-Informationen stehen in ${channelMention(config.serverStatus.statusChannelId)}.`;
  } else if (question.includes('rolle') || question.includes('rang') || question.includes('team')) {
    answer = `Die konfigurierten Teamränge sind: ${listRoles(config.roles.teamRoles)}.`;
  } else if (question.includes('ping')) {
    const pings = config.teamPings.pings.map((ping) => ping.label).filter(Boolean);
    answer = pings.length
      ? `Verfügbare Team-Pings: ${pings.join(', ')}.`
      : 'Es sind keine Team-Pings konfiguriert.';
  } else {
    answer = 'Ich kann Fragen zu Support, Bewerbungen, Tickets, Abmeldungen, Teamrängen, Pings, Server-Status und dem Ingame-Code beantworten.';
  }

  await message.reply({
    content: answer,
    allowedMentions: { repliedUser: false }
  });

  return true;
}
