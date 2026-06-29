const app = require('./app');

// Datastore selection is resolved from config.json (located via KANECTA_CONFIG) —
// there is no KANECTA_DATASTORE default. See @kanecta/lib appConfig.

const PORT = process.env.PORT || 3001;
const HOST = process.env.KANECTA_API_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`kanecta-api listening on ${HOST}:${PORT}`));
