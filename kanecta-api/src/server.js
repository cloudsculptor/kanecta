const path = require('path');
const os = require('os');
const app = require('./app');

if (!process.env.KANECTA_DATASTORE) {
  process.env.KANECTA_DATASTORE = path.join(os.homedir(), '.kanecta', 'datastore');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`kanecta-api listening on port ${PORT}`));
