import { refreshTeamListPanel, refreshTrainerAssignmentsPanel, refreshTrainerDashboardPanel, syncAutomaticTrainerAssignments } from '../utils/panels.js';
import * as trainerDashboard from '../utils/trainerDashboard.js';

function roleSet(member, roleIds) {
  return roleIds.filter((roleId) => roleId && member.roles.cache.has(roleId));
}

export default {
  name: 'guildMemberUpdate',
  once: false,
  async execute(oldMember, newMember, runtime) {
    const teamRoleIds = runtime.config.roles.teamRoles.map((role) => role.id).filter(Boolean);
    const oldRoles = roleSet(oldMember, teamRoleIds);
    const newRoles = roleSet(newMember, teamRoleIds);
    const addedRoles = newRoles.filter((roleId) => !oldRoles.includes(roleId));
    const resolveTrainerAsbRole = trainerDashboard.resolveTrainerAsbRole ?? trainerDashboard.resolveTrainerAsblRole;
    const resolveTrainerTargetRole = trainerDashboard.resolveTrainerTargetRole;
    const asbRole = resolveTrainerAsbRole?.(runtime.config) ?? null;
    const tsupRole = resolveTrainerTargetRole?.(runtime.config) ?? null;
    const nicknameChanged = oldMember.displayName !== newMember.displayName;
    const teamRoleChanged =
      oldRoles.length !== newRoles.length ||
      oldRoles.some((roleId) => !newRoles.includes(roleId)) ||
      newRoles.some((roleId) => !oldRoles.includes(roleId));

    for (const roleId of addedRoles) {
      runtime.db.upsertTeamRoleAssignment(runtime.config.guildId, newMember.id, roleId, Date.now());
    }

    let trainerAssignmentChanged = false;
    if (asbRole?.id && oldRoles.includes(asbRole.id) && !newRoles.includes(asbRole.id)) {
      trainerAssignmentChanged ||= runtime.db.deleteTrainerAssignmentByAsbl(runtime.config.guildId, newMember.id) > 0;
    }

    if (tsupRole?.id && oldRoles.includes(tsupRole.id) && !newRoles.includes(tsupRole.id)) {
      trainerAssignmentChanged ||= runtime.db.deleteTrainerAssignmentsByTsup(runtime.config.guildId, newMember.id) > 0;
    }

    const trainerRoleChanged =
      (asbRole?.id && (oldRoles.includes(asbRole.id) !== newRoles.includes(asbRole.id))) ||
      (tsupRole?.id && (oldRoles.includes(tsupRole.id) !== newRoles.includes(tsupRole.id)));

    if (!nicknameChanged && !teamRoleChanged && !trainerAssignmentChanged && !trainerRoleChanged) {
      return;
    }

    if (trainerRoleChanged) {
      await syncAutomaticTrainerAssignments(newMember.client, runtime).catch(() => null);
    }

    await refreshTeamListPanel(newMember.client, runtime).catch(() => null);
    await refreshTrainerDashboardPanel(newMember.client, runtime).catch(() => null);
    await refreshTrainerAssignmentsPanel(newMember.client, runtime).catch(() => null);
  }
};
