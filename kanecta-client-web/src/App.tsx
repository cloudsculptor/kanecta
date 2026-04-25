import { useEffect, useState } from 'react';
import './App.css';

interface KanectaItem {
  id: string;
  parent_id: string | null;
  value: string;
  type: string;
  children?: KanectaItem[];
}

const ROOT_ID = 'f1a00001-b45e-4c3d-9e7f-000000000001';

function TreeNode({ item }: { item: KanectaItem }) {
  return (
    <li>
      <span className="node-value">{item.value}</span>
      {item.children && item.children.length > 0 && (
        <ul>
          {item.children.map((child) => (
            <TreeNode key={child.id} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function App() {
  const [item, setItem] = useState<KanectaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState(2);

  useEffect(() => {
    setItem(null);
    setError(null);
    fetch(`/api/items/${ROOT_ID}?levels=${levels}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<KanectaItem>;
      })
      .then(setItem)
      .catch((err: Error) => setError(err.message));
  }, [levels]);

  return (
    <main className="app">
      <h1>Kanecta</h1>
      <label className="levels-label">
        Levels
        <input
          className="levels-input"
          type="number"
          min={1}
          value={levels}
          onChange={(e) =>
            setLevels(Math.max(1, parseInt(e.target.value, 10) || 1))
          }
        />
      </label>
      {error && <p className="error">Failed to load item: {error}</p>}
      {!item && !error && <p className="loading">Loading…</p>}
      {item && (
        <ul className="tree">
          <TreeNode item={item} />
        </ul>
      )}
    </main>
  );
}

export default App;
