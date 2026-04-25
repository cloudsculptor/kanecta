import { useEffect, useState } from 'react';
import './App.css';

interface KanectaItem {
  id: string;
  parent_id: string | null;
  value: string;
  type: string;
  owner: string;
  sort_order: number;
}

const ROOT_ID = 'f1a00001-b45e-4c3d-9e7f-000000000001';

function App() {
  const [item, setItem] = useState<KanectaItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/items/${ROOT_ID}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<KanectaItem>;
      })
      .then(setItem)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="app">
      <h1>Kanecta</h1>
      {error && <p className="error">Failed to load item: {error}</p>}
      {!item && !error && <p className="loading">Loading…</p>}
      {item && (
        <dl className="item-card">
          <div className="field">
            <dt>Value</dt>
            <dd>{item.value}</dd>
          </div>
          <div className="field">
            <dt>Type</dt>
            <dd>{item.type}</dd>
          </div>
          <div className="field">
            <dt>ID</dt>
            <dd className="mono">{item.id}</dd>
          </div>
          <div className="field">
            <dt>Parent ID</dt>
            <dd className="mono">{item.parent_id ?? '—'}</dd>
          </div>
          <div className="field">
            <dt>Owner</dt>
            <dd>{item.owner}</dd>
          </div>
          <div className="field">
            <dt>Sort order</dt>
            <dd>{item.sort_order}</dd>
          </div>
        </dl>
      )}
    </main>
  );
}

export default App;
