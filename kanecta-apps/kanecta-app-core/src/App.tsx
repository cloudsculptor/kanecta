import { useEffect, useState } from 'react';
import './App.css';

interface KanectaItem {
  id: string;
  parentId: string | null;
  value: string;
  type: string;
  children?: KanectaItem[];
}

const ROOT_ID = 'f1a00001-b45e-4c3d-9e7f-000000000001';

function TreeNode({ item }: { item: KanectaItem }) {
  return (
    <li data-id={item.id}>
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

  useEffect(() => {
    fetch(`/api/items/${ROOT_ID}?levels=100`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<KanectaItem>;
      })
      .then(setItem)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="app">
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
