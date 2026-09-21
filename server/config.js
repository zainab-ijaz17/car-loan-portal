module.exports = {
  PORT: process.env.PORT || 3000,
  // SAP API Management proxy in front of the ZFREIGHT_SRV_SRV OData
  // service (rate lines) — the APIM proxy maps directly to the service
  // root, so the backend's own /sap/opu/odata/sap/ZFREIGHT_SRV_SRV path
  // (visible in the metadata's atom:link) is NOT part of this URL; adding
  // it 404s. No separate subscription key — calls forward the end user's
  // own Basic Auth, same as SAP would expect directly.
  FREIGHT: {
    baseUrl: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/freight',
  },
  // SAP SuccessFactors — used only to verify an employee ID / password pair
  // at login (see sfClient.js). usernameSuffix turns the employee ID typed
  // at login into the SF username the OData service expects.
  SF: {
    baseUrl: process.env.SF_BASE_URL || 'https://api44.sapsf.com',
    usernameSuffix: process.env.SF_USERNAME_SUFFIX || '@packagesli',
  },
};
