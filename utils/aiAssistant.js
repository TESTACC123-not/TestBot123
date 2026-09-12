const KNOWLEDGE_KEY = 'aiAssistantKnowledge';

function normalize(value) {
  return String(value ?? '').toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();
}

function cleanQuestion(message) {
  const botId = message.client.user?.id;
  return normalize(String(message.content ?? '').replace(new RegExp('<@!?' + botId + '>', 'g'), '').trim());
}

function channelMention(channelId) {
  return channelId ? '<#' + channelId + '>' : 'nicht konfiguriert';
}

function readKnowledge(db, guildId) {
  try {
    const raw = db.getSetting(KNOWLEDGE_KEY + ':' + guildId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.question && entry?.answer) : [];
  } catch {
    return [];
  }
}

function writeKnowledge(db, guildId, knowledge) {
  db.setSetting(KNOWLEDGE_KEY + ':' + guildId, JSON.stringify(knowledge));
}

export function teachAssistant(db, guildId, question, answer) {
  const normalizedQuestion = normalize(question);
  const safeAnswer = String(answer ?? '').trim().slice(0, 1800);
  if (!normalizedQuestion || !safeAnswer) {
    return { ok: false, message: 'Frage und Antwort dürfen nicht leer sein.' };
  }

  const knowledge = readKnowledge(db, guildId);
  const entry = { question: normalizedQuestion.slice(0, 200), answer: safeAnswer };
  const existingIndex = knowledge.findIndex((item) => item.question === entry.question);
  if (existingIndex >= 0) knowledge[existingIndex] = entry;
  else knowledge.push(entry);

  writeKnowledge(db, guildId, knowledge.slice(-100));
  return { ok: true, updated: existingIndex >= 0 };
}

export function forgetAssistantKnowledge(db, guildId, question) {
  const normalizedQuestion = normalize(question);
  const knowledge = readKnowledge(db, guildId);
  const next = knowledge.filter((entry) => entry.question !== normalizedQuestion);
  writeKnowledge(db, guildId, next);
  return knowledge.length - next.length;
}

export function getAssistantKnowledge(db, guildId) {
  return readKnowledge(db, guildId);
}

function findLearnedAnswer(db, guildId, question) {
  const knowledge = readKnowledge(db, guildId);
  return knowledge.find((entry) =>
    question === entry.question ||
    question.includes(entry.question) ||
    entry.question.includes(question)
  )?.answer ?? '';
}

export function buildAssistantHelp() {
  return '**KI-Hilfe**\nErwähne mich mit einer Frage, z. B. @Bot Wo ist Support?\nIch kenne Support, Bewerbungen, Tickets, Abmeldungen, Teamränge, Pings, Server-Status und den Ingame-Code.\nTeamleitung kann mir mit /ki lernen eigene Antworten beibringen.';
}

export async function answerFromConfigKnowledge(message, runtime) {
  if (runtime.config.aiAssistant?.enabled === false) return false;

  const question = cleanQuestion(message);
  if (!question) return false;

  const config = runtime.config;
  let answer = findLearnedAnswer(runtime.db, config.guildId, question);

  if (!answer && (question.includes('hilfe') || question.includes('was kannst') || question === 'help')) {
    answer = buildAssistantHelp();
  } else if (!answer && question.includes('code')) {
    answer = config.gameServerCode
      ? 'Der aktuelle Ingame-Server-Code lautet: ' + config.gameServerCode
      : 'Der Ingame-Server-Code ist noch nicht konfiguriert.';
  } else if (!answer && (question.includes('support') || question.includes('problem'))) {
    answer = 'Für Support nutze bitte ' + channelMention(config.channels.supportChannelId) + '.';
  } else if (!answer && (question.includes('dienst') || question.includes('on duty') || question.includes('off duty'))) {
    answer = 'Das On-Duty-Panel findest du in ' + channelMention(config.duty.panelChannelId) + '.';
  } else if (!answer && (question.includes('bewerbung') || question.includes('bewerben'))) {
    answer = 'Das Bewerbungs-Panel findest du in ' + channelMention(config.bewerbung.panelChannelId) + '.';
  } else if (!answer && question.includes('waffenschein')) {
    answer = 'Das Waffenschein-Panel findest du in ' + channelMention(config.waffenschein.panelChannelId) + '.';
  } else if (!answer && question.includes('fraktion')) {
    answer = 'Fraktions-Anfragen erstellst du in ' + channelMention(config.fraktionsTickets.panelChannelId) + '.';
  } else if (!answer && (question.includes('haus') || question.includes('immobil'))) {
    answer = 'Das Haus-Ticket-Panel findest du in ' + channelMention(config.hausTicket.panelChannelId) + '.';
  } else if (!answer && (question.includes('fly') || question.includes('nametag'))) {
    answer = 'Fly-Anträge stellst du in ' + channelMention(config.fly.channelId) + '. Deinen Roblox-Namen trägst du in ' + channelMention(config.nametag.channelId) + ' ein.';
  } else if (!answer && (question.includes('verify') || question.includes('verifiz'))) {
    answer = 'Das Verify-Panel findest du in ' + channelMention(config.channels.verifyPanelChannelId) + '.';
  } else if (!answer && (question.includes('abmeldung') || question.includes('abmelden'))) {
    answer = 'Das Abmeldungs-Panel findest du in ' + channelMention(config.channels.absencePanelChannelId) + '.';
  } else if (!answer && (question.includes('leaderboard') || question.includes('rangliste'))) {
    answer = 'Die Leaderboards werden in ' + channelMention(config.channels.supportLeaderboardChannelId) + ' angezeigt.';
  } else if (!answer && (question.includes('status') || question.includes('rp') || question.includes('server'))) {
    answer = 'Server-Status und RP-Informationen stehen in ' + channelMention(config.serverStatus.statusChannelId) + '.';
  } else if (!answer && (question.includes('rolle') || question.includes('rang') || question.includes('team'))) {
    const roles = config.roles.teamRoles.map((role) => role.label).filter(Boolean);
    answer = roles.length ? 'Die Teamränge sind: ' + roles.join(', ') : 'Keine Teamrollen sind konfiguriert.';
  } else if (!answer && question.includes('ping')) {
    const pings = config.teamPings.pings.map((ping) => ping.label).filter(Boolean);
    answer = pings.length ? 'Verfügbare Team-Pings: ' + pings.join(', ') + '.' : 'Es sind keine Team-Pings konfiguriert.';
  } else if (!answer && question.includes('teamliste')) {
    answer = 'Die Teamliste findest du in ' + channelMention(config.channels.teamListChannelId) + '.';
  } else if (!answer) {
    answer = 'Das weiß ich noch nicht. Frage nach Hilfe oder bitte die Teamleitung, mir die Antwort mit /ki lernen beizubringen.';
  }

  await message.reply({ content: answer.slice(0, 1900), allowedMentions: { repliedUser: false } });
  return true;
}
