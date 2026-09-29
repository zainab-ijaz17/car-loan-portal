// Coded errors. Every error the API returns carries a short code (e.g.
// "DSL-003") whose prefix says which part of the portal it came from, plus
// a `where` label ("Enter diesel price › Effective date") so a user can go
// straight to the field that needs fixing — and quote the code if they
// have to report it. Full list: ERROR_CODES.md at the repo root.
//
// app/js/ui.js keeps a copy of AREAS for errors raised in the browser.
const AREAS = {
  AUTH: 'Sign in',
  DSL: 'Enter diesel price',
  UPL: 'Notification attachment',
  VND: 'Select vendors',
  REV: 'Review before / after',
  APR: 'Approve and release',
  MD: 'Master data',
  CR: 'Master data requests',
  LKP: 'Rate lookup',
  ALR: 'Notifications',
  SYS: 'Server',
};

class AppError extends Error {
  constructor(code, message, { status = 422, field } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

function fail(code, message, opts) {
  return new AppError(code, message, opts);
}

function whereFor(code, field) {
  const area = AREAS[code.split('-')[0]] || 'Server';
  return field ? `${area} › ${field}` : area;
}

// `context` describes what the route was doing ("saving the agreement"),
// used only when the error wasn't one of ours — a database outage, a bug.
function sendError(res, err, context) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ code: err.code, message: err.message, where: whereFor(err.code, err.field), field: err.field || null });
  }
  console.error(`Unexpected error while ${context}:`, err);
  return res.status(500).json({
    code: 'SYS-500',
    message: `Unexpected server error while ${context}. Try again; if it keeps happening, report this code and the time it happened.`,
    where: `Server › ${context}`,
    field: null,
  });
}

// Wraps an async route so a thrown/rejected error always becomes a coded
// JSON response instead of an unhandled rejection that hangs the request.
function handle(context, fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      sendError(res, err, context);
    }
  };
}

module.exports = { AREAS, AppError, fail, sendError, handle };
