-- Freight Rate Portal's own data: vendor master, rate sheets, revision
-- history, and the pending-approval workflow. All idempotent (IF NOT
-- EXISTS) so this can just run on every server start.
--
-- Scoped to diesel-indexed per-trip freight rates for the five vendors
-- covered by the last revision — see the project's scope document. Flat
-- per-category rate cards and dedicated-vehicle contracts (found while
-- reviewing the source Excel workbook) are explicitly out of scope and
-- were removed after briefly existing here.

-- validity_start/validity_end: the agreement's own validity period
-- (DD.MM.YYYY, same convention as every other date in this app) —
-- separate from rate revisions, which are about rates changing *within*
-- an agreement. Null end means open-ended / not yet due for renewal.
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  annexure TEXT,
  pass_through_pct NUMERIC NOT NULL DEFAULT 0,
  rounding_rule TEXT NOT NULL DEFAULT 'Nearest 100',
  stale BOOLEAN NOT NULL DEFAULT false,
  validity_start TEXT,
  validity_end TEXT
);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS validity_start TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS validity_end TEXT;

CREATE TABLE IF NOT EXISTS rate_sheets (
  vendor_id TEXT PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  title TEXT,
  annexure TEXT,
  cols JSONB NOT NULL,
  weights JSONB NOT NULL,
  rows JSONB NOT NULL
);

-- Uploaded diesel-price notification files (Section 5: mandatory
-- attachment). Deliberately NOT part of the vendors/rateSheets/etc.
-- wipe-and-reinsert blob store.js loads and saves as one unit — that
-- pattern already lost data once (category_rates/dedicated_vehicle_
-- contracts) because it wasn't taught about tables added later. This
-- table is written directly, once, on upload, and never touched by
-- saveDb, so it can't be silently dropped by an unrelated write.
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  uploaded_by JSONB,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revisions (
  revision_no INTEGER PRIMARY KEY,
  diesel_price NUMERIC NOT NULL,
  effective_date TEXT NOT NULL,
  factor NUMERIC NOT NULL DEFAULT 1,
  approved_by TEXT,
  approved_on TEXT,
  notification_id INTEGER REFERENCES notifications(id)
);
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS notification_id INTEGER REFERENCES notifications(id);

-- Exact archived rate-sheet rows for a (vendor, revision) once that
-- revision has actually been released — see rateAtRevision in
-- rateEngine.js. `rows` is the published (rounded) rate, same shape as
-- rate_sheets.rows — what every existing lookup already reads.
-- `audit_rows` is the audit trail Section 6 requires alongside it: per
-- line, the base rate it was computed from and the unrounded adjusted
-- rate, as [{dest, base: number[], sum: number[], rounded: number[]}].
-- Null for a revision that predates this (the seed data's revisions
-- 20/21 — those only have the scalar-factor approximation, not a real
-- audit trail).
CREATE TABLE IF NOT EXISTS rate_snapshots (
  vendor_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  rows JSONB NOT NULL,
  audit_rows JSONB,
  PRIMARY KEY (vendor_id, revision_no)
);
ALTER TABLE rate_snapshots ADD COLUMN IF NOT EXISTS audit_rows JSONB;

-- Singleton values: current_revision_no (integer) and pending_revision
-- (the in-flight revision object, or null).
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB
);

-- In-app notifications ("Revision 23 approved", "returned for correction",
-- "new master data request", …). Addressed either to one employee or to
-- everyone holding a role; read_by tracks who has opened a role-wide one.
-- actor_employee_id is whoever caused it, so they aren't notified of their
-- own action. Like `notifications` above, written directly — never part
-- of saveDb's wipe-and-reinsert.
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  recipient_employee_id TEXT,
  recipient_role TEXT,
  actor_employee_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_by JSONB NOT NULL DEFAULT '[]'
);

-- Master data changes that need a Rate Approver's sign-off before they
-- take effect: adding a vendor / destination / vehicle type, deleting a
-- vendor / destination. Raised by an Administrator; approving one applies
-- it to vendors/rate_sheets in the same transaction. Written directly,
-- never part of saveDb's wipe-and-reinsert.
CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  vendor_id TEXT,
  payload JSONB NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by JSONB NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by JSONB,
  decided_at TIMESTAMPTZ,
  decision_note TEXT
);
