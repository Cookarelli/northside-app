module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/tests/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.tsx"],
  clearMocks: true,
  moduleNameMapper: {
    "^@northside/customer-contracts/service-requests$":
      "<rootDir>/../../packages/customer-contracts/src/service-requests.ts",
    "^@northside/customer-contracts/tracking$":
      "<rootDir>/../../packages/customer-contracts/src/tracking.ts",
    "^@northside/customer-contracts/shopping$":
      "<rootDir>/../../packages/customer-contracts/src/shopping.ts",
    "^@northside/customer-contracts$":
      "<rootDir>/../../packages/customer-contracts/src/index.ts",
    "^@northside/customer-contracts/mvp$":
      "<rootDir>/../../packages/customer-contracts/src/mvp.ts",
    "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1",
    "^@northside/customer-contracts/mobile$":
      "<rootDir>/../../packages/customer-contracts/src/mobile.ts",
  },
};
