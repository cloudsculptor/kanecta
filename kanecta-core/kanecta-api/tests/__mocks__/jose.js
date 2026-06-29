'use strict';

// jose@6 is ESM-only; jest (without a babel ESM transform) cannot load it. It is
// pulled in transitively by jwks-rsa and is only *invoked* during real JWT
// signature verification — which the API test suites do not exercise (they cover
// AUTH_DISABLED and token-rejection paths). This CJS stub lets the modules load;
// any actual use throws loudly so a test that genuinely needs jose can't pass
// silently against a stub.
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      return () => {
        throw new Error(`jose.${String(prop)} is stubbed in tests (see tests/__mocks__/jose.js)`);
      };
    },
  },
);
