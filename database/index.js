import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export class BotDatabase {
  constructor(databasePath) {
    const resolvedPath = path.isAbsolute(databasePath)
      ? databasePath
      : path.resolve(process.cwd(), databasePath);

    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    this.path = resolvedPath;
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.#init();
    this.#migrateTrainerAssignments();
    this.#dedupeTrainerAssignmentsByTsup();
  }

  #init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS panel_messages (
        panel_key TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS support_cases (
        case_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        supporter_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        taken_at INTEGER,
        ended_at INTEGER,
        support_channel_id TEXT NOT NULL,
        message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_support_cases_guild_status ON support_cases(guild_id, status);
      CREATE INDEX IF NOT EXISTS idx_support_cases_user ON support_cases(guild_id, user_id);

      CREATE TABLE IF NOT EXISTS waiting_requests (
        request_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        handler_id TEXT,
        status TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        taken_at INTEGER,
        ended_at INTEGER,
        message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_waiting_requests_guild_status ON waiting_requests(guild_id, status);
      CREATE INDEX IF NOT EXISTS idx_waiting_requests_user ON waiting_requests(guild_id, user_id);

      CREATE TABLE IF NOT EXISTS roblox_names (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        roblox_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS verified_members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        verified_at INTEGER NOT NULL,
        verified_by TEXT,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS team_role_assignments (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, role_id)
      );

      CREATE INDEX IF NOT EXISTS idx_team_role_assignments_guild_role
        ON team_role_assignments(guild_id, role_id);

      CREATE TABLE IF NOT EXISTS trainer_assignments (
        guild_id TEXT NOT NULL,
        asbl_user_id TEXT NOT NULL,
        tsup_user_id TEXT NOT NULL,
        assigned_by TEXT,
        assigned_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, asbl_user_id, tsup_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_trainer_assignments_guild_tsup
        ON trainer_assignments(guild_id, tsup_user_id);

      CREATE TABLE IF NOT EXISTS fly_requests (
        request_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        roblox_name TEXT NOT NULL,
        team_role_id TEXT,
        nametag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        reviewer_id TEXT,
        status TEXT NOT NULL,
        message_channel_id TEXT,
        message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_fly_requests_guild_status ON fly_requests(guild_id, status);

      CREATE TABLE IF NOT EXISTS absences (
        absence_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        from_at INTEGER NOT NULL,
        to_at INTEGER NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        ended_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_absences_guild_status ON absences(guild_id, status);
      CREATE INDEX IF NOT EXISTS idx_absences_user ON absences(guild_id, user_id);

      CREATE TABLE IF NOT EXISTS real_estates (
        guild_id TEXT NOT NULL,
        property_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        price_label TEXT NOT NULL,
        status TEXT NOT NULL,
        user_ids TEXT NOT NULL DEFAULT '[]',
        note TEXT,
        updated_by TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, property_id)
      );
    `);
  }

  #migrateTrainerAssignments() {
    const columns = this.db.prepare('PRAGMA table_info(trainer_assignments)').all();
    if (!columns.length) {
      return;
    }

    const hasCompositePrimaryKey = columns.some((column) => column.name === 'tsup_user_id' && Number(column.pk) > 0);
    if (hasCompositePrimaryKey) {
      return;
    }

    const legacyRows = this.db.prepare(`
      SELECT guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      FROM trainer_assignments
    `).all();

    this.db.transaction(() => {
      this.db.exec(`
        DROP INDEX IF EXISTS idx_trainer_assignments_guild_tsup;

        ALTER TABLE trainer_assignments RENAME TO trainer_assignments_legacy;

        CREATE TABLE trainer_assignments (
          guild_id TEXT NOT NULL,
          asbl_user_id TEXT NOT NULL,
          tsup_user_id TEXT NOT NULL,
          assigned_by TEXT,
          assigned_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, asbl_user_id, tsup_user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_trainer_assignments_guild_tsup
          ON trainer_assignments(guild_id, tsup_user_id);
      `);

      const insertAssignment = this.db.prepare(`
        INSERT INTO trainer_assignments (
          guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, asbl_user_id, tsup_user_id) DO UPDATE SET
          assigned_by = excluded.assigned_by,
          assigned_at = excluded.assigned_at,
          updated_at = excluded.updated_at
      `);

      for (const row of legacyRows) {
        insertAssignment.run(
          row.guild_id,
          row.asbl_user_id,
          row.tsup_user_id,
          row.assigned_by ?? null,
          row.assigned_at,
          row.updated_at
        );
      }

      this.db.exec('DROP TABLE trainer_assignments_legacy;');
    })();
  }

  #dedupeTrainerAssignmentsByTsup() {
    const rows = this.db.prepare(`
      SELECT rowid, guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      FROM trainer_assignments
      ORDER BY updated_at DESC, assigned_at DESC, rowid DESC
    `).all();

    if (!rows.length) {
      return;
    }

    const seen = new Set();
    const duplicateRowIds = [];

    for (const row of rows) {
      const key = `${row.guild_id}:${row.tsup_user_id}`;
      if (seen.has(key)) {
        duplicateRowIds.push(row.rowid);
      } else {
        seen.add(key);
      }
    }

    if (!duplicateRowIds.length) {
      return;
    }

    const deleteRow = this.db.prepare('DELETE FROM trainer_assignments WHERE rowid = ?');
    this.db.transaction((rowIds) => {
      for (const rowId of rowIds) {
        deleteRow.run(rowId);
      }
    })(duplicateRowIds);
  }

  close() {
    this.db.close();
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value ?? null;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  getPanelMessage(panelKey) {
    return this.db.prepare('SELECT * FROM panel_messages WHERE panel_key = ?').get(panelKey) ?? null;
  }

  upsertPanelMessage(panelKey, guildId, channelId, messageId) {
    this.db.prepare(`
      INSERT INTO panel_messages (panel_key, guild_id, channel_id, message_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(panel_key) DO UPDATE SET
        guild_id = excluded.guild_id,
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        updated_at = excluded.updated_at
    `).run(panelKey, guildId, channelId, messageId, Date.now());
  }

  deletePanelMessage(panelKey) {
    this.db.prepare('DELETE FROM panel_messages WHERE panel_key = ?').run(panelKey);
  }

  getRobloxName(guildId, userId) {
    return this.db.prepare(
      'SELECT roblox_name, updated_at FROM roblox_names WHERE guild_id = ? AND user_id = ?'
    ).get(guildId, userId) ?? null;
  }

  listRobloxNames(guildId) {
    return this.db.prepare(`
      SELECT user_id, roblox_name, updated_at
      FROM roblox_names
      WHERE guild_id = ?
    `).all(guildId);
  }

  upsertRobloxName(guildId, userId, robloxName) {
    this.db.prepare(`
      INSERT INTO roblox_names (guild_id, user_id, roblox_name, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        roblox_name = excluded.roblox_name,
        updated_at = excluded.updated_at
    `).run(guildId, userId, robloxName, Date.now());
  }

  deleteRobloxName(guildId, userId) {
    this.db.prepare('DELETE FROM roblox_names WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  isVerified(guildId, userId) {
    return Boolean(this.db.prepare(
      'SELECT 1 FROM verified_members WHERE guild_id = ? AND user_id = ?'
    ).get(guildId, userId));
  }

  markVerified(guildId, userId, verifiedBy) {
    this.db.prepare(`
      INSERT INTO verified_members (guild_id, user_id, verified_at, verified_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        verified_at = excluded.verified_at,
        verified_by = excluded.verified_by
    `).run(guildId, userId, Date.now(), verifiedBy ?? null);
  }

  getTeamRoleAssignment(guildId, userId, roleId) {
    return this.db.prepare(`
      SELECT guild_id, user_id, role_id, assigned_at, updated_at
      FROM team_role_assignments
      WHERE guild_id = ? AND user_id = ? AND role_id = ?
    `).get(guildId, userId, roleId) ?? null;
  }

  upsertTeamRoleAssignment(guildId, userId, roleId, assignedAt = Date.now()) {
    this.db.prepare(`
      INSERT INTO team_role_assignments (guild_id, user_id, role_id, assigned_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET
        assigned_at = excluded.assigned_at,
        updated_at = excluded.updated_at
    `).run(guildId, userId, roleId, assignedAt, Date.now());
  }

  getTrainerAssignmentByAsbl(guildId, asblUserId) {
    return this.getTrainerAssignmentsForAsbl(guildId, asblUserId)[0] ?? null;
  }

  getTrainerAssignmentsForAsbl(guildId, asblUserId) {
    return this.db.prepare(`
      SELECT guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      FROM trainer_assignments
      WHERE guild_id = ? AND asbl_user_id = ?
      ORDER BY tsup_user_id ASC, assigned_at ASC
    `).all(guildId, asblUserId);
  }

  getTrainerAssignmentsForTsup(guildId, tsupUserId) {
    return this.db.prepare(`
      SELECT guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      FROM trainer_assignments
      WHERE guild_id = ? AND tsup_user_id = ?
      ORDER BY updated_at DESC, assigned_at DESC
    `).all(guildId, tsupUserId);
  }

  getTrainerAssignmentByTsup(guildId, tsupUserId) {
    return this.db.prepare(`
      SELECT guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      FROM trainer_assignments
      WHERE guild_id = ? AND tsup_user_id = ?
      ORDER BY updated_at DESC, assigned_at DESC
      LIMIT 1
    `).get(guildId, tsupUserId) ?? null;
  }

  listTrainerAssignments(guildId) {
    return this.db.prepare(`
      SELECT guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      FROM trainer_assignments
      WHERE guild_id = ?
      ORDER BY asbl_user_id ASC, tsup_user_id ASC, assigned_at ASC
    `).all(guildId);
  }

  upsertTrainerAssignment(guildId, asblUserId, tsupUserId, assignedBy = null, assignedAt = Date.now()) {
    const insert = this.db.prepare(`
      INSERT INTO trainer_assignments (
        guild_id, asbl_user_id, tsup_user_id, assigned_by, assigned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, asbl_user_id, tsup_user_id) DO UPDATE SET
        assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at,
        updated_at = excluded.updated_at
    `);

    this.db.transaction(() => {
      this.deleteTrainerAssignmentsByTsup(guildId, tsupUserId);
      insert.run(guildId, asblUserId, tsupUserId, assignedBy ?? null, assignedAt, Date.now());
    })();
  }

  ensureTrainerAssignment(guildId, asblUserId, tsupUserId, assignedBy = null, assignedAt = Date.now()) {
    const existing = this.getTrainerAssignmentByTsup(guildId, tsupUserId);
    if (existing?.asbl_user_id === asblUserId) {
      return false;
    }

    this.upsertTrainerAssignment(guildId, asblUserId, tsupUserId, assignedBy, assignedAt);
    return true;
  }

  deleteTrainerAssignmentsByGuild(guildId) {
    return this.db.prepare(`
      DELETE FROM trainer_assignments
      WHERE guild_id = ?
    `).run(guildId).changes;
  }

  deleteTrainerAssignmentByAsbl(guildId, asblUserId) {
    return this.db.prepare(`
      DELETE FROM trainer_assignments
      WHERE guild_id = ? AND asbl_user_id = ?
    `).run(guildId, asblUserId).changes;
  }

  deleteTrainerAssignmentsByTsup(guildId, tsupUserId) {
    return this.db.prepare(`
      DELETE FROM trainer_assignments
      WHERE guild_id = ? AND tsup_user_id = ?
    `).run(guildId, tsupUserId).changes;
  }

  createSupportCase(record) {
    this.db.prepare(`
      INSERT INTO support_cases (
        case_id, guild_id, user_id, supporter_id, status, created_at, taken_at, ended_at, support_channel_id, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.caseId,
      record.guildId,
      record.userId,
      record.supporterId ?? null,
      record.status,
      record.createdAt,
      record.takenAt ?? null,
      record.endedAt ?? null,
      record.supportChannelId,
      record.messageId ?? null
    );
  }

  getSupportCase(caseId, guildId) {
    return this.db.prepare('SELECT * FROM support_cases WHERE case_id = ? AND guild_id = ?').get(caseId, guildId) ?? null;
  }

  getSupportCaseStatsForSupporter(guildId, supporterId) {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS totalCases,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closedCases,
        COALESCE(SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END), 0) AS activeCases
      FROM support_cases
      WHERE guild_id = ? AND supporter_id = ?
    `).get(guildId, supporterId) ?? {
      totalCases: 0,
      closedCases: 0,
      activeCases: 0
    };
  }

  getOpenSupportCaseByUser(guildId, userId) {
    return this.db.prepare(`
      SELECT * FROM support_cases
      WHERE guild_id = ? AND user_id = ? AND status IN ('open', 'taken')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(guildId, userId) ?? null;
  }

  getActiveSupportCases(guildId) {
    return this.db.prepare(`
      SELECT * FROM support_cases
      WHERE guild_id = ? AND status IN ('open', 'taken')
      ORDER BY created_at DESC
    `).all(guildId);
  }

  claimSupportCase(guildId, caseId, supporterId) {
    const result = this.db.prepare(`
      UPDATE support_cases
      SET supporter_id = ?, taken_at = ?, status = 'taken'
      WHERE guild_id = ? AND case_id = ? AND status = 'open' AND supporter_id IS NULL
    `).run(supporterId, Date.now(), guildId, caseId);

    return result.changes === 1;
  }

  closeSupportCase(guildId, caseId, supporterId = null, endedAt = Date.now()) {
    const result = this.db.prepare(`
      UPDATE support_cases
      SET status = 'closed', ended_at = ?
      WHERE guild_id = ? AND case_id = ? AND status IN ('open', 'taken') AND (? IS NULL OR supporter_id = ?)
    `).run(endedAt, guildId, caseId, supporterId, supporterId);

    return result.changes === 1;
  }

  expireOpenSupportCasesForUser(guildId, userId, excludeCaseId, endedAt = Date.now()) {
    return this.db.prepare(`
      UPDATE support_cases
      SET status = 'expired', ended_at = ?
      WHERE guild_id = ? AND user_id = ? AND status = 'open' AND case_id != ?
    `).run(endedAt, guildId, userId, excludeCaseId).changes;
  }

  expireStaleOpenSupportCases(guildId, olderThanMs, now = Date.now()) {
    const cutoff = now - olderThanMs;
    return this.db.prepare(`
      UPDATE support_cases
      SET status = 'expired', ended_at = ?
      WHERE guild_id = ? AND status = 'open' AND created_at < ?
    `).run(now, guildId, cutoff).changes;
  }

  updateSupportCaseMessage(guildId, caseId, messageId) {
    this.db.prepare(`
      UPDATE support_cases
      SET message_id = ?
      WHERE guild_id = ? AND case_id = ?
    `).run(messageId, guildId, caseId);
  }

  getSupportLeaderboard(guildId, limit = 10) {
    return this.db.prepare(`
      SELECT
        supporter_id AS userId,
        COUNT(*) AS caseCount
      FROM support_cases
      WHERE guild_id = ? AND status = 'closed' AND supporter_id IS NOT NULL
      GROUP BY supporter_id
      ORDER BY caseCount DESC, supporter_id ASC
      LIMIT ?
    `).all(guildId, limit);
  }

  createWaitingRequest(record) {
    this.db.prepare(`
      INSERT INTO waiting_requests (
        request_id, guild_id, user_id, type, handler_id, status, channel_id, created_at, taken_at, ended_at, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.requestId,
      record.guildId,
      record.userId,
      record.type,
      record.handlerId ?? null,
      record.status,
      record.channelId,
      record.createdAt,
      record.takenAt ?? null,
      record.endedAt ?? null,
      record.messageId ?? null
    );
  }

  getWaitingRequest(requestId, guildId) {
    return this.db.prepare('SELECT * FROM waiting_requests WHERE request_id = ? AND guild_id = ?').get(requestId, guildId) ?? null;
  }

  getOpenWaitingRequestByUser(guildId, userId, type) {
    return this.db.prepare(`
      SELECT * FROM waiting_requests
      WHERE guild_id = ? AND user_id = ? AND type = ? AND status IN ('open', 'taken')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(guildId, userId, type) ?? null;
  }

  getActiveWaitingRequests(guildId, type) {
    return this.db.prepare(`
      SELECT * FROM waiting_requests
      WHERE guild_id = ? AND type = ? AND status IN ('open', 'taken')
      ORDER BY created_at DESC
    `).all(guildId, type);
  }

  claimWaitingRequest(guildId, requestId, handlerId, type) {
    const result = this.db.prepare(`
      UPDATE waiting_requests
      SET handler_id = ?, taken_at = ?, status = 'taken'
      WHERE guild_id = ? AND type = ? AND request_id = ? AND status = 'open' AND handler_id IS NULL
    `).run(handlerId, Date.now(), guildId, type, requestId);

    return result.changes === 1;
  }

  closeWaitingRequest(guildId, requestId, handlerId = null, endedAt = Date.now(), type) {
    const result = this.db.prepare(`
      UPDATE waiting_requests
      SET status = 'closed', ended_at = ?
      WHERE guild_id = ? AND type = ? AND request_id = ? AND status IN ('open', 'taken') AND (? IS NULL OR handler_id = ?)
    `).run(endedAt, guildId, type, requestId, handlerId, handlerId);

    return result.changes === 1;
  }

  expireOpenWaitingRequestsForUser(guildId, userId, excludeRequestId, type, endedAt = Date.now()) {
    return this.db.prepare(`
      UPDATE waiting_requests
      SET status = 'expired', ended_at = ?
      WHERE guild_id = ? AND user_id = ? AND type = ? AND status = 'open' AND request_id != ?
    `).run(endedAt, guildId, userId, type, excludeRequestId).changes;
  }

  updateWaitingRequestMessage(guildId, requestId, messageId) {
    this.db.prepare(`
      UPDATE waiting_requests
      SET message_id = ?
      WHERE guild_id = ? AND request_id = ?
    `).run(messageId, guildId, requestId);
  }

  createFlyRequest(record) {
    this.db.prepare(`
      INSERT INTO fly_requests (
        request_id, guild_id, user_id, display_name, reason, roblox_name, team_role_id, nametag, created_at, reviewed_at, reviewer_id, status, message_channel_id, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.requestId,
      record.guildId,
      record.userId,
      record.displayName,
      record.reason,
      record.robloxName,
      record.teamRoleId ?? null,
      record.nametag,
      record.createdAt,
      record.reviewedAt ?? null,
      record.reviewerId ?? null,
      record.status,
      record.messageChannelId ?? null,
      record.messageId ?? null
    );
  }

  getFlyRequest(requestId, guildId) {
    return this.db.prepare('SELECT * FROM fly_requests WHERE request_id = ? AND guild_id = ?').get(requestId, guildId) ?? null;
  }

  getOpenFlyRequestByUser(guildId, userId) {
    return this.db.prepare(`
      SELECT * FROM fly_requests
      WHERE guild_id = ? AND user_id = ? AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(guildId, userId) ?? null;
  }

  reviewFlyRequest(guildId, requestId, reviewerId) {
    const result = this.db.prepare(`
      UPDATE fly_requests
      SET status = 'reviewed', reviewed_at = ?, reviewer_id = ?
      WHERE guild_id = ? AND request_id = ? AND status = 'open'
    `).run(Date.now(), reviewerId, guildId, requestId);

    return result.changes === 1;
  }

  updateFlyRequestMessage(guildId, requestId, messageId, messageChannelId) {
    this.db.prepare(`
      UPDATE fly_requests
      SET message_id = ?, message_channel_id = ?
      WHERE guild_id = ? AND request_id = ?
    `).run(messageId, messageChannelId, guildId, requestId);
  }

  createAbsence(record) {
    this.db.prepare(`
      INSERT INTO absences (
        absence_id, guild_id, user_id, from_at, to_at, reason, status, created_at, ended_at, ended_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.absenceId,
      record.guildId,
      record.userId,
      record.fromAt,
      record.toAt,
      record.reason,
      record.status,
      record.createdAt,
      record.endedAt ?? null,
      record.endedBy ?? null
    );
  }

  getAbsence(absenceId, guildId) {
    return this.db.prepare('SELECT * FROM absences WHERE absence_id = ? AND guild_id = ?').get(absenceId, guildId) ?? null;
  }

  getActiveAbsenceByUser(guildId, userId) {
    return this.db.prepare(`
      SELECT * FROM absences
      WHERE guild_id = ? AND user_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(guildId, userId) ?? null;
  }

  getActiveAbsences(guildId) {
    return this.db.prepare(`
      SELECT * FROM absences
      WHERE guild_id = ? AND status = 'active'
      ORDER BY to_at ASC
    `).all(guildId);
  }

  getExpiredAbsences(guildId, now = Date.now()) {
    return this.db.prepare(`
      SELECT * FROM absences
      WHERE guild_id = ? AND status = 'active' AND to_at <= ?
      ORDER BY to_at ASC
    `).all(guildId, now);
  }

  closeAbsence(guildId, absenceId, endedBy = null, endedAt = Date.now()) {
    const result = this.db.prepare(`
      UPDATE absences
      SET status = 'ended', ended_at = ?, ended_by = ?
      WHERE guild_id = ? AND absence_id = ? AND status = 'active'
    `).run(endedAt, endedBy, guildId, absenceId);

    return result.changes === 1;
  }

  getActiveAbsenceCount(guildId) {
    return this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM absences
      WHERE guild_id = ? AND status = 'active'
    `).get(guildId).count;
  }

  removeMemberData(guildId, userId) {
    this.deleteRobloxName(guildId, userId);
  }

  ensureRealEstateDefaults(guildId, properties) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO real_estates (
        guild_id, property_id, label, price_label, status, user_ids, note, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, 'available', '[]', NULL, NULL, ?)
    `);

    const updateBaseData = this.db.prepare(`
      UPDATE real_estates
      SET label = ?, price_label = ?
      WHERE guild_id = ? AND property_id = ? AND status = 'available' AND user_ids = '[]' AND note IS NULL
    `);

    this.db.transaction(() => {
      for (const property of properties) {
        insert.run(guildId, property.id, property.label, property.priceLabel, Date.now());
        updateBaseData.run(property.label, property.priceLabel, guildId, property.id);
      }
    })();
  }

  listRealEstates(guildId) {
    return this.db.prepare(`
      SELECT guild_id, property_id, label, price_label, status, user_ids, note, updated_by, updated_at
      FROM real_estates
      WHERE guild_id = ?
      ORDER BY property_id ASC
    `).all(guildId);
  }

  getRealEstate(guildId, propertyId) {
    return this.db.prepare(`
      SELECT guild_id, property_id, label, price_label, status, user_ids, note, updated_by, updated_at
      FROM real_estates
      WHERE guild_id = ? AND property_id = ?
    `).get(guildId, propertyId) ?? null;
  }

  updateRealEstateStatus(guildId, propertyId, { status, userIds = [], note = null, updatedBy = null, updatedAt = Date.now() }) {
    const result = this.db.prepare(`
      UPDATE real_estates
      SET status = ?, user_ids = ?, note = ?, updated_by = ?, updated_at = ?
      WHERE guild_id = ? AND property_id = ?
    `).run(
      status,
      JSON.stringify([...new Set(userIds.map(String).filter(Boolean))]),
      note,
      updatedBy,
      updatedAt,
      guildId,
      propertyId
    );

    return result.changes === 1;
  }

  updateRealEstatePrice(guildId, propertyId, priceLabel, updatedBy = null) {
    const result = this.db.prepare(`
      UPDATE real_estates
      SET price_label = ?, updated_by = ?, updated_at = ?
      WHERE guild_id = ? AND property_id = ?
    `).run(priceLabel, updatedBy, Date.now(), guildId, propertyId);

    return result.changes === 1;
  }
}
