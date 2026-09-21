// Employee ID -> assigned role(s). The SuccessFactors login check (see
// sfClient.js) only confirms the employee ID / password pair; it doesn't
// return a role, so role assignment for this app has to live here instead
// of being picked by the user at login. Anyone who authenticates but isn't
// listed gets 'Display' (view-only) rather than being rejected.
//
// Everyone gets exactly one role except where `roles` lists more than
// one — that's a pick-a-role account (screens/login.js prompts for which
// one to use for the session) rather than a normal single-role assignment.
const ALL_ROLES = ['Rate Maintainer', 'Approver', 'Display', 'Administrator'];
const DEFAULT_ROLE = 'Display';

const ROSTER = {
  '20005702': { name: 'Imran Nisar', roles: ['Rate Maintainer'] },
  '20003559': { name: 'Ghulam Hussain', roles: ['Rate Maintainer'] },
  '10009732': { name: 'Farhan Amin', roles: ['Approver'] },
  '10009654': { name: '10009654', roles: ALL_ROLES },
  '10009760': { name: '10009760', roles: ALL_ROLES },
};

function assignmentFor(employeeId) {
  return ROSTER[employeeId] || { name: employeeId, roles: [DEFAULT_ROLE] };
}

module.exports = { assignmentFor };
