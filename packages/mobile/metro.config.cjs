const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
const extraNodeModules = { ...(config.resolver.extraNodeModules || {}) };
const babelRuntime = [
  path.resolve(projectRoot, "node_modules/@babel/runtime"),
  path.resolve(workspaceRoot, "node_modules/@babel/runtime"),
].find((item) => fs.existsSync(item));
if (babelRuntime) extraNodeModules["@babel/runtime"] = babelRuntime;
try {
  extraNodeModules["@expo/vector-icons"] = path.dirname(
    require.resolve("@expo/vector-icons/package.json", { paths: [require.resolve("expo/package.json")] }),
  );
} catch {
  /* Expo already ships the icon fonts; Metro just needs the JS path. */
}
config.resolver.extraNodeModules = extraNodeModules;
config.resolver.unstable_enablePackageExports = true;
config.transformer.babelTransformerPath = require.resolve("./metro-babel-transformer.cjs");
config.transformer.enableBabelRCLookup = false;
config.transformer.hermesParser = false;
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const stem = moduleName.slice(0, -3);
    for (const ext of [".ts", ".tsx", ""]) {
      try {
        return context.resolveRequest(context, `${stem}${ext}`, platform);
      } catch {
        /* try next */
      }
    }
  }
  return defaultResolve
    ? defaultResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
