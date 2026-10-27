const AuditLog = require('../models/AuditLog');

async function logAudit(actor, action, entity, entityId, beforeState, afterState) {
  try {
    await AuditLog.create({
      actor,
      action,
      entity,
      entityId: entityId ? entityId.toString() : null,
      beforeState,
      afterState
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
    throw new Error(`Unable to record the ${action} audit entry.`, { cause: err });
  }
}

module.exports = { logAudit };