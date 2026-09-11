// Alle Zeitangaben des Bots werden fest in deutscher Zeit (Europe/Berlin) ausgegeben,
// unabhängig von der Zeitzone des Servers, auf dem der Bot läuft.

const TIME_ZONE = 'Europe/Berlin';

const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getZonedParts(date) {
  const parts = dateTimeFormatter.formatToParts(date);
  const result = {};

  for (const part of parts) {
    result[part.type] = part.value;
  }

  return result;
}

/**
 * Zeitzonen-Versatz (in Millisekunden) von Europe/Berlin zum Zeitpunkt `date`.
 * Berücksichtigt automatisch Sommer-/Winterzeit.
 */
function getBerlinOffsetMs(date) {
  const parts = getZonedParts(date);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wandelt eine deutsche Uhrzeit (Wanduhrzeit) in den passenden Zeitpunkt um. */
function berlinWallClockToDate(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = naive - getBerlinOffsetMs(new Date(naive));
  timestamp = naive - getBerlinOffsetMs(new Date(timestamp));
  return new Date(timestamp);
}

export function formatGermanDateTime(value) {
  const date = toDate(value);
  if (!date) {
    return '';
  }

  const parts = getZonedParts(date);
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

export function formatGermanDate(value) {
  const date = toDate(value);
  if (!date) {
    return '';
  }

  return dateFormatter.format(date);
}

export function formatGermanTime(value) {
  const date = toDate(value);
  if (!date) {
    return '';
  }

  const parts = getZonedParts(date);
  return `${parts.hour}:${parts.minute}`;
}

export function formatDuration(seconds = 0) {
  let remaining = Math.max(0, Math.floor(seconds));
  const parts = [];

  const days = Math.floor(remaining / 86400);
  if (days) {
    parts.push(`${days} Tg`);
    remaining -= days * 86400;
  }

  const hours = Math.floor(remaining / 3600);
  if (hours) {
    parts.push(`${hours} Std`);
    remaining -= hours * 3600;
  }

  const minutes = Math.floor(remaining / 60);
  if (minutes) {
    parts.push(`${minutes} Min`);
    remaining -= minutes * 60;
  }

  if (!parts.length || remaining) {
    parts.push(`${remaining} Sek`);
  }

  return parts.join(' ');
}

export function formatDurationMs(milliseconds = 0) {
  return formatDuration(milliseconds / 1000);
}

/** Liest „TT.MM.JJ HH:MM“ bzw. „TT.MM.JJJJ HH:MM“ als deutsche Uhrzeit ein. */
export function parseGermanDateTime(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  const value = String(input ?? '').trim();
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const date = berlinWallClockToDate(year, month, day, hour, minute);
  const parts = getZonedParts(date);

  // Ungültige Daten (z. B. 31.02.) abfangen.
  if (
    Number(parts.day) !== day ||
    Number(parts.month) !== month ||
    Number(parts.year) !== year ||
    Number(parts.hour) !== hour ||
    Number(parts.minute) !== minute
  ) {
    return null;
  }

  return date;
}

export function formatRelativeTime(target, now = Date.now()) {
  const targetTime = target instanceof Date ? target.getTime() : new Date(target).getTime();
  const diff = Math.max(0, Math.floor((targetTime - now) / 1000));
  return formatDuration(diff);
}
