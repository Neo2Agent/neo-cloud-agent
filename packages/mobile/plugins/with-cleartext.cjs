const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/** Standalone APKs block HTTP unless the merged manifest allows cleartext. */
function withCleartext(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.$["android:usesCleartextTraffic"] = "true";
    const permissions = new Set(
      (manifest.manifest["uses-permission"] ?? []).map((item) => item.$["android:name"]),
    );
    for (const name of ["android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"]) {
      if (permissions.has(name)) continue;
      manifest.manifest["uses-permission"] = manifest.manifest["uses-permission"] ?? [];
      manifest.manifest["uses-permission"].push({ $: { "android:name": name } });
    }
    return mod;
  });
}

module.exports = withCleartext;
