export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/*.test.js"],
  moduleNameMapper: {
    "^jwks-rsa$": "<rootDir>/__mocks__/jwks-rsa.js",
    "^jsonwebtoken$": "<rootDir>/__mocks__/jsonwebtoken.js",
  },
};
