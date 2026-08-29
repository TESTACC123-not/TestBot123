function pad(number) {
  return String(number).padStart(2, '0');
}

export function formatGermanDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatGermanDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
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

export function parseGermanDateTime(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const value = input.trim();
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
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
