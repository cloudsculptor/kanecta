// jose@6 is ESM-only and is pulled in transitively by jwks-rsa; it is only
// *invoked* during real JWT signature verification — which the API test suites
// do not exercise (they cover AUTH_DISABLED and token-rejection paths). This
// stub is aliased in for `jose` via vitest.config.ts so the modules load; any
// actual use throws loudly so a test that genuinely needs jose can't pass
// silently against a stub.
export default new Proxy(
  {},
  {
    get(_target, prop) {
      return () => {
        throw new Error(`jose.${String(prop)} is stubbed in tests (see tests/__mocks__/jose.ts)`);
      };
    },
  },
);
