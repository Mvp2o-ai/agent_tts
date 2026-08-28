const appJson = require('./app.json');

function loadOperatorEas() {
  try {
    return require('./eas-project.local.json');
  } catch {
    return {};
  }
}

const operator = loadOperatorEas();
const extra = { ...(appJson.expo.extra || {}) };
if (typeof operator.projectId === 'string' && operator.projectId.length > 0) {
  extra.eas = { ...(extra.eas || {}), projectId: operator.projectId };
}

module.exports = {
  expo: {
    ...appJson.expo,
    extra,
    ...(typeof operator.owner === 'string' && operator.owner.length > 0
      ? { owner: operator.owner }
      : {}),
  },
};
