/**
 * Expo's Metro transformer both (1) injects expo/internal/babel-preset because
 * loadBabelConfig ignores babel.config.cjs and (2) parses @flow files with
 * hermes-parser reactRuntimeTarget=19, which already writes __self. Either
 * path plus babel-preset-expo's automatic JSX runtime throws
 * "Duplicate __self prop". Drive Babel ourselves with one config file.
 */
const { createRequire } = require("module");
const path = require("path");

const babel = createRequire(require.resolve("babel-preset-expo"))("@babel/core");
const configFile = path.resolve(__dirname, "babel.config.cjs");

function stringOrUndefined(value) {
  return typeof value === "string" ? value : undefined;
}

function getCaller(filename, options) {
  const custom = options.customTransformOptions || {};
  return {
    name: "metro",
    bundler: "metro",
    platform: options.platform,
    isServer: custom.environment === "react-server" || custom.environment === "node",
    isReactServer: custom.environment === "react-server",
    baseUrl: stringOrUndefined(custom.baseUrl) || "",
    routerRoot: stringOrUndefined(custom.routerRoot) || "app",
    isDev: options.dev,
    engine: stringOrUndefined(custom.engine),
    projectRoot: options.projectRoot,
    isNodeModule: filename.includes("node_modules"),
    isHMREnabled: true,
    metroSourceType: options.type,
    supportsStaticESM: Boolean(options.experimentalImportSupport) || String(custom.optimize) === "true",
    supportsReactCompiler: String(custom.reactCompiler) === "true" ? true : undefined,
  };
}

function transform({ filename, src, options, plugins }) {
  const previous = process.env.BABEL_ENV;
  process.env.BABEL_ENV = options.dev ? "development" : previous || "production";
  try {
    const result = babel.transformSync(src, {
      ast: true,
      babelrc: false,
      caller: getCaller(filename, options),
      cloneInputAst: false,
      code: false,
      configFile,
      cwd: options.projectRoot,
      filename,
      highlightCode: true,
      plugins,
      sourceType: "unambiguous",
    });
    if (!result) {
      return { ast: null };
    }
    return { ast: result.ast, metadata: result.metadata };
  } finally {
    if (previous) process.env.BABEL_ENV = previous;
  }
}

module.exports = { transform };
