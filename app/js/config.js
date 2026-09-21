// Central place to point the portal at the real SAP-fronting API gateway.
// Nothing else in the app should hardcode a URL — every api/*.js module
// reads it from here.
export const CONFIG = {
  // Base URL this portal's own backend (server/) serves under. All
  // request paths in the api/*.js modules are relative to this.
  API_BASE_URL: '/api/sap',
};
