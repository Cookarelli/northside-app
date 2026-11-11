// Metro loads this .cjs configuration with Node's CommonJS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
const config = getDefaultConfig(__dirname);
const contracts = path.resolve(__dirname, "../../packages/customer-contracts");
const portableZod = require.resolve("zod", {
  paths: [path.dirname(require.resolve("@northside/customer-contracts/mvp"))],
});
config.watchFolders = [...config.watchFolders, contracts];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target =
    moduleName === "@northside/customer-contracts/service-requests"
      ? path.join(contracts, "src/service-requests.ts")
      : moduleName === "@northside/customer-contracts/tracking"
        ? path.join(contracts, "src/tracking.ts")
        : moduleName === "@northside/customer-contracts/shopping"
          ? path.join(contracts, "src/shopping.ts")
          : moduleName === "zod" &&
              context.originModulePath.startsWith(contracts + path.sep)
            ? portableZod
            : moduleName;
  return context.resolveRequest(context, target, platform);
};
module.exports = config;
