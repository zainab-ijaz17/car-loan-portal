// Writes one in-app notification (see the alerts table in schema.sql).
// Pass the transaction's client so it commits or rolls back together with
// the change it announces.
async function createAlert(client, { toEmployeeId = null, toRole = null, actor, kind, title, body = null, link = null }) {
  await client.query(
    'INSERT INTO alerts (recipient_employee_id, recipient_role, actor_employee_id, kind, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [toEmployeeId, toRole, actor?.employeeId ?? null, kind, title, body, link]
  );
}

module.exports = { createAlert };
