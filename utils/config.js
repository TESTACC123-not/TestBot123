import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
//  config.js — Liest die bot-Konfiguration aus config.json (im Bot-Ordner).
//
//  Die ECHTE Konfiguration steht IMMER in deiner config.json, NICHT hier.
//  Dieses File liest sie nur ein, füllt fehlende Werte mit einem Standard
//  und baut daraus ein sauberes Objekt, das der ganze Bot benutzt.
//
//  WICHTIG zur Vereinfachung:
//  Jeder Dienst-Bereich (= jede Rolle) wird als EIN Block unter
//  `duty.areas` konfiguriert. Dort gehört EIGENER Kanal + EIGENE Räume dazu.
//  Die alte getrennte `waitingRooms`-Struktur wird automatisch übernommen
//  (rückwärtskompatibel) — du kannst sie künftig einfach weglassen.
// ============================================================================

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) {
    return fallback;
  }

  return JSON.parse(raw);
}

function normalizeQuestions(questions = []) {
  return questions
    .filter(Boolean)
    .map((question, index) => {
      if (typeof question === 'string') {
        return {
          id: `q${index + 1}`,
          question,
          answers: []
        };
      }

      return {
        id: question.id ?? `q${index + 1}`,
        question: question.question ?? '',
        answers: Array.isArray(question.answers) ? question.answers.filter(Boolean) : []
      };
    });
}

function normalizeTeamRoles(teamRoles = []) {
  return teamRoles
    .filter(Boolean)
    .map((role, index) => {
      if (typeof role === 'string') {
        return {
          id: role,
          label: `Teamrolle ${index + 1}`
        };
      }

      return {
        id: role.id ?? '',
        label: role.label ?? `Teamrolle ${index + 1}`
      };
    });
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

// Wandelt die Team-Ping-Buttons in ein sauberes Array um.
// Unterstützt einfache Strings "ROLLE_ID" und Objekte { label, emoji, roleId, waitingRoomType }.
// waitingRoomType verknüpft den Button mit einem Dienst-Bereich (z. B. "highTeam" oder "leitung")
// aus duty.areas, damit der Benutzer beim Aktivieren in dessen Warteraum verschoben
// und beim Deaktivieren aus dem Call gekickt wird (wie im Support-/Wartebereich-System).
function normalizeTeamPings(pings = []) {
  return pings
    .filter(Boolean)
    .map((ping, index) => {
      if (typeof ping === 'string') {
        return { label: `Ping ${index + 1}`, emoji: '', roleId: ping, waitingRoomType: '' };
      }

      return {
        label: String(ping.label ?? ping.name ?? `Ping ${index + 1}`).trim(),
        emoji: String(ping.emoji ?? '').trim(),
        roleId: String(ping.roleId ?? '').trim(),
        waitingRoomType: String(ping.waitingRoomType ?? '').trim()
      };
    })
    .filter((ping) => ping.roleId);
}

// Wandelt eine Liste von Fragen/Zeilen in ein Array sauberer Strings um.
// Unterstützt sowohl einfache Strings als auch Objekte mit { question } / { label }.
function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          return String(entry.question ?? entry.label ?? entry.text ?? '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  return [];
}

// Wandelt die Waffenschein-Stufen in ein Objekt { a: {label, description, price}, ... } um.
// Akzeptiert ein Objekt { a: "Waffenschein A", ... } oder { a: {label, description, price}, ... }.
function normalizeWaffenscheinTypes(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const k = String(key).toLowerCase();
    if (typeof entry === 'string') {
      result[k] = { label: entry.trim(), description: '', price: '', roleId: '' };
    } else if (entry && typeof entry === 'object') {
      result[k] = {
        label: String(entry.label ?? entry.name ?? k).trim(),
        description: String(entry.description ?? '').trim(),
        price: String(entry.price ?? '').trim(),
        roleId: String(entry.roleId ?? '').trim()
      };
    }
  }
  return result;
}

export function loadConfig(baseDir = process.cwd()) {
  const configPath = path.join(baseDir, 'config.json');
  const config = readJson(configPath, {});

  // --------------------------------------------------------------------------
  //  EIN DIENST-BEREICH = EINE ROLLE + EIGENER KANAL + EIGENE RÄUME.
  //  Jeder Dienst-Bereich (Support, High Team, Leitung) folgt demselben Schema.
  //  serverStatus ist ein eigener, unabhängiger Block (siehe unten).
  //
  //  area = der Bereichsschlüssel (support, highTeam, leitung).
  //    label             Anzeigename im On-Duty-Panel.
  //    roleId            Die On-Duty-Rolle dieses Bereichs (wird an-/abgezogen).
  //    caseChannelId     Textkanal: hier erscheinen die Anfragen/Wartebereiche.
  //    waitingChannelId  Voice: der Raum, in dem Kunden warten (Einstieg).
  //    activeChannelId   Voice: Kunde wird hierhin verschoben, sobald übernommen.
  //    finishedChannelId Voice: Kunde wird hierhin verschoben, sobald erledigt.
  //    handlerRoleIds    Optional: weitere Rollen, die Anfragen annehmen dürfen.
  //    pingRoleIds       Optional: weitere Rollen, die bei neuen Anfragen benachrichtigt werden.
  // --------------------------------------------------------------------------
  const areas = {};

  const areaDefaults = {
    support: { label: 'Support' },
    highTeam: { label: 'High Team' },
    leitung: { label: 'Leitung' }
  };

  // Unterstützte Rückfall-Quellen je Feld und Bereich.
  // "block"  = neues, vereinheitlichtes Schema  config.duty.areas.<key>.<feld>
  // "support"= alte Support-Felder (nur für den Bereich "support")
  // "legacy" = altes Schema                     config.waitingRooms.<key>.<feld>
  const supportLegacy = {
    caseChannelId: config.channels?.supportChannelId,
    waitingChannelId: config.support?.waitingRoomVoiceChannelId,
    activeChannelId: config.support?.activeVoiceChannelId,
    finishedChannelId: config.support?.finishedVoiceChannelId
  };
  const legacyField = {
    caseChannelId: 'caseChannelId',
    waitingChannelId: 'voiceChannelId',
    activeChannelId: 'activeVoiceChannelId',
    finishedChannelId: 'finishedVoiceChannelId'
  };

  for (const areaKey of ['support', 'highTeam', 'leitung']) {
    const block = config.duty?.areas?.[areaKey] ?? {};
    const legacy = config.waitingRooms?.[areaKey] ?? {};
    const isSupport = areaKey === 'support';

    // Nimmt das erste vorhandene Feld aus der Kette (leere Werte werden übersprungen).
    const pick = (field) =>
      [block[field], ...(isSupport ? [supportLegacy[field]] : []), legacy[legacyField[field]]].find(
        (value) => value
      ) ?? '';

    areas[areaKey] = {
      // Anzeigename (z. B. für das On-Duty-Panel).
      label: block.label ?? areaDefaults[areaKey].label,
      // On-Duty-Rolle. Support fällt auf die alte "onDutyRoleId" zurück.
      roleId: block.roleId ?? (isSupport ? config.roles?.onDutyRoleId : '') ?? '',
      // Textkanal, in dem die Anfragen erscheinen.
      caseChannelId: pick('caseChannelId'),
      // Voice-Warteraum (Einstieg des Kunden).
      waitingChannelId: pick('waitingChannelId'),
      // Voice-Raum "in Bearbeitung".
      activeChannelId: pick('activeChannelId'),
      // Voice-Raum "erledigt".
      finishedChannelId: pick('finishedChannelId'),
      // Zusätzliche Rollen, die Anfragen annehmen dürfen.
      handlerRoleIds:
        normalizeArray(block.handlerRoleIds).length
          ? normalizeArray(block.handlerRoleIds)
          : normalizeArray(legacy.handlerRoleIds),
      // Zusätzliche Rollen, die bei neuen Anfragen benachrichtigt werden.
      pingRoleIds:
        normalizeArray(block.pingRoleIds).length
          ? normalizeArray(block.pingRoleIds)
          : normalizeArray(legacy.pingRoleIds)
    };
  }

  return {
    // Dein Discord-Bot-Token (leer lassen, wenn es in einer .env steht).
    token: config.token ?? '',
    // Die "Application ID" deines Bots (Discord Developer Portal).
    clientId: config.clientId ?? '',
    // Die ID deines Discord-Servers (Guild).
    guildId: config.guildId ?? '',
    // Pfad zur SQLite-Datenbank (relative Pfade zählen ab dem Bot-Ordner).
    databasePath: config.databasePath ?? './work/bot.sqlite',
    // Ob der Bot seine Slash-Commands beim Start automatisch registriert.
    registerCommandsOnStartup: config.registerCommandsOnStartup !== false,

    // ------------------------------------------------------------------------
    //  ALLGEMEINE KANÄLE  (die übergeordneten Kanäle des Servers).
    // ------------------------------------------------------------------------
    channels: {
      supportChannelId: config.channels?.supportChannelId ?? '',
      supportLogChannelId: config.channels?.supportLogChannelId ?? '',
      supportLeaderboardChannelId: config.channels?.supportLeaderboardChannelId ?? '',
      dutyLogChannelId: config.channels?.dutyLogChannelId ?? '',
      verifyPanelChannelId: config.channels?.verifyPanelChannelId ?? '',
      welcomeChannelId: config.channels?.welcomeChannelId ?? '',
      goodbyeChannelId: config.channels?.goodbyeChannelId ?? '',
      teamListChannelId: config.channels?.teamListChannelId ?? '',
      absencePanelChannelId: config.channels?.absencePanelChannelId ?? '',
      activeAbsencesChannelId: config.channels?.activeAbsencesChannelId ?? '',
      absenceLogChannelId: config.channels?.absenceLogChannelId ?? ''
    },

    // Kanäle für Fly- / Nametag-Anträge.
    fly: {
      channelId: config.fly?.channelId ?? '',
      // Eigener Kanal für neue Anträge (getrennt vom Panel).
      requestChannelId: config.fly?.requestChannelId ?? '',
      // Spezieller Kanal, in den bearbeitete Anträge verschoben werden.
      doneChannelId: config.fly?.doneChannelId ?? ''
    },

    // Kanal für Nametag-Anzeigen.
    nametag: {
      channelId: config.nametag?.channelId ?? ''
    },

    // ------------------------------------------------------------------------
    //  SUPPORT
    //  supporterRoleIds: Rollen, die Support-Fälle zusätzlich übernehmen dürfen.
    //  Die Support-Räume (warten/aktiv/erledigt) stehen unter `duty.areas.support`.
    // ------------------------------------------------------------------------
    support: {
      supporterRoleIds: normalizeArray(config.support?.supporterRoleIds)
    },

    // ------------------------------------------------------------------------
    //  Hinweis: Es gibt keinen eigenen "waitingRooms"-Block mehr. Die
    //  Wartebereiche aller Bereiche (auch Support) kommen ausschließlich aus
    //  `duty.areas.<bereich>.waitingChannelId` usw. – EIN Eintrag pro Bereich.
    // ------------------------------------------------------------------------

    // ------------------------------------------------------------------------
    //  IC-COUNTER  (Spielerzahl-Meldung für den Server-Status).
    //  Falls kein eigener "icCounter"-Block existiert, werden die Kanäle und
    //  die Ping-Rolle automatisch aus "serverStatus" übernommen – so muss der
    //  Nutzer die Kanäle nicht doppelt eintragen.
    // ------------------------------------------------------------------------
    icCounter: {
      statusChannelId: config.icCounter?.statusChannelId ?? config.serverStatus?.statusChannelId ?? '',
      messageChannelId: config.icCounter?.messageChannelId ?? config.serverStatus?.messageChannelId ?? '',
      pingRoleId: config.icCounter?.pingRoleId ?? config.serverStatus?.pingRoleId ?? '',
      intervalMinutes: Math.max(1, Number(config.icCounter?.intervalMinutes) || Number(config.serverStatus?.pingIntervalMinutes) || 5),
      playerCap: Math.max(1, Number(config.icCounter?.playerCap) || Number(config.serverStatus?.playerCap) || 50),
      pushThreshold: Math.max(1, Number(config.icCounter?.pushThreshold) || 40),
      offlineThreshold: Math.max(0, Number(config.icCounter?.offlineThreshold) || 5)
    },

    // ------------------------------------------------------------------------
    //  SERVER-STATUS  (RP-Start / RP-Stopp, Push-Nachrichten).
    // ------------------------------------------------------------------------
    serverStatus: {
      rpChannelId: config.serverStatus?.rpChannelId ?? '',
      statusChannelId: config.serverStatus?.statusChannelId ?? config.icCounter?.statusChannelId ?? '',
      pingRoleId: config.serverStatus?.pingRoleId ?? (config.icCounter?.pingRoleId ?? ''),
      pushChannelId: config.serverStatus?.pushChannelId ?? '',
      staffRoleId: config.serverStatus?.staffRoleId ?? '',
      statusRoleId: config.serverStatus?.statusRoleId ?? '',
      leaderboardChannelId: config.serverStatus?.leaderboardChannelId ?? '',
      rpStopThreshold: Math.max(0, Number(config.serverStatus?.rpStopThreshold) ?? 10),
      rpStartThreshold: Math.max(0, Number(config.serverStatus?.rpStartThreshold) ?? 30),
      pingIntervalMinutes: Math.max(1, Number(config.serverStatus?.pingIntervalMinutes) || 5),
      playerCap: Math.max(1, Number(config.serverStatus?.playerCap) || 50)
    },

    // ------------------------------------------------------------------------
    //  ON-DUTY-SYSTEM  (JEDER BEREICH = EINE ROLLE + EIGENE KANÄLE/RÄUME).
    //  Das ist ab jetzt die EINE zentrale Stelle für alle Dienst-Bereiche.
    // ------------------------------------------------------------------------
    duty: {
      // Textkanal, in dem das On-Duty-Panel (On/Off je Bereich) gepostet wird.
      panelChannelId: config.duty?.panelChannelId ?? '',
      areas
    },

    // ------------------------------------------------------------------------
    //  ROLLEN  (die wichtigsten Discord-Rollen des Servers).
    // ------------------------------------------------------------------------
    roles: {
      onDutyRoleId: config.roles?.onDutyRoleId ?? '',
      unverifyRoleId: config.roles?.unverifyRoleId ?? '',
      citizenRoleId: config.roles?.citizenRoleId ?? '',
      absenceRoleId: config.roles?.absenceRoleId ?? '',
      trainerRoleId: config.roles?.trainerRoleId ?? '',
      // T-Sup-Rolle (ASB ↔ T-Sup-Zuordnung + Ausbilder-Dashboard). Wird nur über
      // diese explizite ID aufgelöst; die teamRoles-Beschriftung dient nur als Fallback.
      trainerTargetRoleId: config.roles?.trainerTargetRoleId ?? '',
      supporterRoleIds: normalizeArray(config.roles?.supporterRoleIds),
      flyReviewerRoleIds: normalizeArray(config.roles?.flyReviewerRoleIds),
      teamRoles: normalizeTeamRoles(config.roles?.teamRoles)
    },

    // Kategorie, in der automatisch erstellte Kanäle landen (optional).
    categories: {
      teamCategoryId: config.categories?.teamCategoryId ?? ''
    },

    // Haus-Kauf-Ticket-Panel.
    hausTicket: {
      panelChannelId: config.hausTicket?.panelChannelId ?? '',
      categoryId: config.hausTicket?.categoryId ?? '',
      pingRoleId: config.hausTicket?.pingRoleId ?? ''
    },

    // Waffenschein-Ticket-System (Panel, Stufen A/B/C, Ticket, Annehmen/Ablehnen, Rolle + DM).
    waffenschein: {
      // Kanal, in dem das Waffenschein-Panel liegt.
      panelChannelId: config.waffenschein?.panelChannelId ?? '',
      // Kategorie, in der Waffenschein-Tickets erstellt werden.
      categoryId: config.waffenschein?.categoryId ?? '',
      // Rolle, die bei einem neuen Ticket gepinnt wird (Team).
      pingRoleId: config.waffenschein?.pingRoleId ?? '',
      // Rolle, die bei Annahme an den Antragsteller vergeben wird.
      acceptRoleId: config.waffenschein?.acceptRoleId ?? '',
      // Bank-Konto, an das überwiesen werden muss (Hinweis im Ticket).
      bankAccount: config.waffenschein?.bankAccount ?? 'Guar443344',
      // Waffenschein-Stufen (a/b/c). Jede mit label/description/price.
      types: normalizeWaffenscheinTypes(config.waffenschein?.types)
    },

    // Fraktions-Tickets-System (Panel + Anfrage-Ticket, ohne Rollenvergabe).
    fraktionsTickets: {
      // Kanal, in dem das Fraktions-Tickets-Panel liegt.
      panelChannelId: config.fraktionsTickets?.panelChannelId ?? '',
      // Kategorie, in der Fraktions-Tickets erstellt werden.
      categoryId: config.fraktionsTickets?.categoryId ?? '',
      // Rolle, die bei einem neuen Ticket gepinnt wird (Team).
      pingRoleId: config.fraktionsTickets?.pingRoleId ?? '',
      // Titel des Tickets (optional).
      title: config.fraktionsTickets?.title ?? 'Fraktions-Anfrage'
    },

    // Bewerbungssystem (Antrag per DM, Ergebnis-Kanal, Annehmen/Ablehnen).
    bewerbung: {
      // Kanal, in dem das Bewerbungs-Panel mit dem "Bewerben"-Button liegt.
      panelChannelId: config.bewerbung?.panelChannelId ?? '',
      // Kanal, in dem fertige Bewerbungen mit Ping erscheinen.
      resultChannelId: config.bewerbung?.resultChannelId ?? '',
      // Rolle, die bei einer neuen Bewerbung gepinnt wird.
      pingRoleId: config.bewerbung?.pingRoleId ?? '',
      // Rolle, die ein angenommener Bewerber bekommt.
      acceptRoleId: config.bewerbung?.acceptRoleId ?? '',
      // Rolle, die ein abgelehnter Bewerber für eine Zeit bekommt.
      rejectRoleId: config.bewerbung?.rejectRoleId ?? '',
      // Wie lange die Ablehnungs-Rolle gesetzt bleibt (Stunden, Standard 48).
      rejectDurationHours: Math.max(1, Number(config.bewerbung?.rejectDurationHours) || 48),
      // Rollen, die Annehmen/Ablehnen dürfen.
      reviewerRoleIds: normalizeArray(config.bewerbung?.reviewerRoleIds),
      // Bewerbungs-Fragen, die per DM gestellt werden (eine nach der anderen).
      questions: normalizeStringList(config.bewerbung?.questions)
    },

    // Team-Update-Nachrichten (z. B. Beförderungen).
    teamUpdate: {
      channelId: config.teamUpdate?.channelId ?? '',
      // Rolle, die bei JEDEM Team-Update-Eintrag gepinnt wird (alle Vorlagen).
      teamPingRoleId:
        config.teamUpdate?.teamPingRoleId ??
        config.teamUpdate?.warnPingRoleId ??
        '',
      warnRoleIds: normalizeArray(config.teamUpdate?.warnRoleIds)
    },

    // Team-Ping-Panel: Buttons, die eine bestimmte Team-Rolle pingen.
    teamPings: {
      // Kanal, in dem das Panel gepostet wird.
      channelId: config.teamPings?.channelId ?? '',
      // Kanal, in dem die Ping-Nachricht erscheint (Standard: der Kanal, in dem geklickt wurde).
      pingChannelId: config.teamPings?.pingChannelId ?? '',
      // Liste der Buttons: { label, emoji, roleId }.
      pings: normalizeTeamPings(config.teamPings?.pings)
    },

    // Verify-Fragen (werden neuen Mitgliedern beim Verifizieren gestellt).
    verify: {
      questions: normalizeQuestions(config.verify?.questions)
    },

    // Begrüßungs- / Verabschiedungs-Nachrichten.
    welcome: {
      template: config.welcome?.template ?? ''
    },
    goodbye: {
      template: config.goodbye?.template ?? ''
    },

    // ------------------------------------------------------------------------
    //  PANELS  (Nachricht-IDs: der Bot merkt sich hier, welche Nachricht
    //  welches Panel ist, damit er sie aktualisieren statt neu posten kann).
    // ------------------------------------------------------------------------
    panels: {
      supportLeaderboard: {
        channelId: config.panels?.supportLeaderboard?.channelId ?? '',
        messageId: config.panels?.supportLeaderboard?.messageId ?? ''
      },
      onDuty: {
        channelId: config.panels?.onDuty?.channelId ?? '',
        messageId: config.panels?.onDuty?.messageId ?? ''
      },
      verify: {
        channelId: config.panels?.verify?.channelId ?? '',
        messageId: config.panels?.verify?.messageId ?? ''
      },
      teamList: {
        channelId: config.panels?.teamList?.channelId ?? '',
        messageId: config.panels?.teamList?.messageId ?? ''
      },
      trainerDashboard: {
        channelId: config.panels?.trainerDashboard?.channelId ?? '',
        messageId: config.panels?.trainerDashboard?.messageId ?? ''
      },
      trainerAssignments: {
        channelId: config.panels?.trainerAssignments?.channelId ?? '',
        messageId: config.panels?.trainerAssignments?.messageId ?? ''
      },
      realEstate: {
        channelId: config.panels?.realEstate?.channelId ?? '',
        messageId: config.panels?.realEstate?.messageId ?? ''
      },
      fly: {
        channelId: config.panels?.fly?.channelId ?? '',
        messageId: config.panels?.fly?.messageId ?? ''
      },
      absence: {
        channelId: config.panels?.absence?.channelId ?? '',
        messageId: config.panels?.absence?.messageId ?? ''
      },
      activeAbsences: {
        channelId: config.panels?.activeAbsences?.channelId ?? '',
        messageId: config.panels?.activeAbsences?.messageId ?? ''
      },
      bewerbung: {
        channelId: config.panels?.bewerbung?.channelId ?? '',
        messageId: config.panels?.bewerbung?.messageId ?? ''
      }
    }
  };
}

export function loadNametags(baseDir = process.cwd()) {
  const nametagsPath = path.join(baseDir, 'nametags.json');
  const data = readJson(nametagsPath, {});

  return {
    default: data.default ?? '[TEAM]',
    mappings: Array.isArray(data.mappings)
      ? data.mappings
          .filter(Boolean)
          .map((mapping) => ({
            roleId: mapping.roleId ?? '',
            nametag: mapping.nametag ?? '[TEAM]'
          }))
      : []
  };
}
