const jwksClient = () => ({
  getSigningKey: (kid, cb) => cb(null, { getPublicKey: () => "mock-public-key" }),
});
export default jwksClient;
