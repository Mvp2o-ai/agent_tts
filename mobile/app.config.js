const appJson = require('./app.json');

function loadOperatorEas() {
  try {
    return require('./eas-project.local.json');
  } catch {
    return {};
  }
}

function loadOperatorAppIdentity() {
  try {
    return require('./app-identity.local.json');
  } catch {
    return {};
  }
}

const operator = loadOperatorEas();
const appIdentity = loadOperatorAppIdentity();
const extra = { ...(appJson.expo.extra || {}) };
if (typeof operator.projectId === 'string' && operator.projectId.length > 0) {
  extra.eas = { ...(extra.eas || {}), projectId: operator.projectId };
}

module.exports = {
  expo: {
    ...appJson.expo,
    extra,
    ios: {
      ...appJson.expo.ios,
      ...(typeof appIdentity.bundleIdentifier === 'string'
        ? { bundleIdentifier: appIdentity.bundleIdentifier }
        : {}),
    },
    android: {
      ...appJson.expo.android,
      ...(typeof appIdentity.androidPackage === 'string'
        ? { package: appIdentity.androidPackage }
        : typeof appIdentity.bundleIdentifier === 'string'
          ? { package: appIdentity.bundleIdentifier }
          : {}),
    },
    ...(typeof operator.owner === 'string' && operator.owner.length > 0
      ? { owner: operator.owner }
      : {}),
  },
};
