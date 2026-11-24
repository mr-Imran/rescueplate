/**
 * Appends an audit record inside the caller's transaction, so the log entry and
 * the change it describes are committed (or rolled back) together.
 *
 * `actor` is the authenticated user, or null for the background sweeper.
 */
export async function audit(tx, actor, action, entityType, entityId, { before = null, after = null, meta = null } = {}) {
  await tx.query(
    `INSERT INTO audit_log (actor_id, actor_label, action, entity_type, entity_id, before, after, meta, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor?.id ?? null,
      actor ? `${actor.name} (${actor.role})` : 'System',
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      meta ? JSON.stringify(meta) : null,
      actor?.requestId ?? null,
    ],
  );
}
