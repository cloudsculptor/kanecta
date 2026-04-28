'use strict';

const express = require('express');
const { KanectaConnector } = require('@kanecta/lib');

const PORT = process.env.PORT || 3000;
const DATASTORE_PATH = process.env.DATASTORE_PATH || '../../featherston-datastore';

const store = new KanectaConnector({ datastorePath: DATASTORE_PATH });
const app = express();

app.use(express.json());

app.get('/api/items/:id', async (req, res) => {
  try {
    const item = await store.getItem(req.params.id);
    res.json(item);
  } catch (err) {
    if (err.message.startsWith('Item not found')) {
      res.status(404).json({ error: err.message });
    } else if (err.message.startsWith('Invalid UUID')) {
      res.status(400).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`featherston-api listening on port ${PORT}`);
  console.log(`datastore: ${DATASTORE_PATH}`);
});
