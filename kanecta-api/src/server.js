const path = require('path');
const os = require('os');
const app = require('./app');

if (!process.env.KANECTA_DATASTORE) {
  process.env.KANECTA_DATASTORE = path.join(os.homedir(), '.kanecta');
}

const PORT = process.env.PORT || 3001;
const HOST = process.env.KANECTA_API_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`kanecta-api listening on ${HOST}:${PORT}`));
