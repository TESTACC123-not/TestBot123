import { PermissionFlagsBits } from 'discord.js';

export const DUTY_AREAS = ['support', 'highTeam', 'leitung'];

const AREA_LABELS = {
  support: 'Support',
  highTeam: 'High Team',
  leitung: 'Leitung'
};

export function getDutyAreaLabel(runtime, area) {
  return getDutyAreaConfig(runtime, area)?.label || AREA_LABELS[area] || 'Dienst';
}

export function getDutyAreaConfig(runtime, area) {
  return runtime.config.duty?.areas?.[area] ?? null;
}

export function getDutyRoleId(runtime, area) {
  return getDutyAreaConfig(runtime, area)?.roleId ?? '';
}

export function hasDutyRole(member, runtime, area) {
  const roleId = getDutyRoleId(runtime, area);
  return Boolean(roleId && member?.roles?.cache?.has?.(roleId));
}

export function isAdmin(member) {
  return Boolean(
    member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
  );
}

export function isOnDuty(member, runtime, area) {
  if (!member) {
    return false;
  }
  return isAdmin(member) || hasDutyRole(member, runtime, area);
}

/**
 * Kann ein Mitglied Anliegen/Bereich bearbeiten?
 * On Duty ODER explizite Handler-Rollen ODER Admin.
 */
export function canHandle(member, runtime, area, extraRoleIds = []) {
  if (!member) {
    return false;
  }
  if (isOnDuty(member, runtime, area)) {
    return true;
  }
  return [...(extraRoleIds ?? [])].some((roleId) => roleId && member.roles.cache.has(roleId));
}

export async function toggleDutyRole(member, runtime, area, on) {
  const roleId = getDutyRoleId(runtime, area);
  if (!roleId) {
    return { ok: false, reason: 'duty-role-missing' };
  }

  try {
    if (on) {
      await member.roles.add(roleId);
    } else {
      await member.roles.remove(roleId);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'discord-error', error };
  }
}

/**
 * Konfigurierte Duty-Bereiche (nur solche mit einer Rolle), für Panels/Berechtigungen.
 */
export function getConfiguredDutyAreas(runtime) {
  return DUTY_AREAS.filter((area) => getDutyRoleId(runtime, area));
}
