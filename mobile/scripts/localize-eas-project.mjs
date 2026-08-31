import { readFileSync, writeFileSync } from "node:fs";

const resultPath = process.argv[2];
if (!resultPath) {
  throw new Error("EAS init result path is required");
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));
for (const field of ["projectId", "owner", "slug", "dashboardUrl"]) {
  if (typeof result[field] !== "string" || !result[field].trim()) {
    throw new Error(`EAS init did not return ${field}`);
  }
}

writeFileSync(
  "eas-project.local.json",
  `${JSON.stringify(
    {
      owner: result.owner,
      projectId: result.projectId,
      slug: result.slug,
      dashboard: result.dashboardUrl,
    },
    null,
    2,
  )}\n`,
);

// eas init normally writes identity into app.json. Keep the public tree
// provider-neutral by moving only the values it just created to the ignored
// local identity file.
const appJson = JSON.parse(readFileSync("app.json", "utf8"));
let changed = false;
if (appJson.expo?.owner === result.owner) {
  delete appJson.expo.owner;
  changed = true;
}
if (appJson.expo?.extra?.eas?.projectId === result.projectId) {
  delete appJson.expo.extra.eas;
  if (Object.keys(appJson.expo.extra).length === 0) {
    delete appJson.expo.extra;
  }
  changed = true;
}
if (changed) {
  writeFileSync("app.json", `${JSON.stringify(appJson, null, 2)}\n`);
}

console.log(result.dashboardUrl);
