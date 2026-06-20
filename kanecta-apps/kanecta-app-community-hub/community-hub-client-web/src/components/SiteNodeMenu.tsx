import { useEffect, useRef, useState } from "react";
import { updateSiteNode, createSiteNode, type SiteNode } from "../api/site-nodes";

function toSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const isCategory = (node: SiteNode) => node.metadata.level === "category";

interface Props {
  node: SiteNode;
  siblings: SiteNode[];
  index: number;
  govType?: "procedure" | "policy";
  onMove: (direction: "up" | "down") => Promise<void>;
  onDelete: () => Promise<void>;
  onSaved: () => void;
}

type View = "menu" | "edit" | "add-category" | "delete-confirm";

export default function SiteNodeMenu({ node, siblings, index, govType, onMove, onDelete, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.metadata.description ?? "");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function close() {
    setOpen(false);
    setView("menu");
    setTitle(node.title);
    setDescription(node.metadata.description ?? "");
    setNewTitle("");
    setNewDescription("");
    setError("");
  }

  function toggle() {
    if (open) { close(); return; }
    setTitle(node.title);
    setDescription(node.metadata.description ?? "");
    setView("menu");
    setOpen(true);
  }

  async function handleMove(dir: "up" | "down") {
    setBusy(true);
    try { await onMove(dir); close(); onSaved(); } catch { /* ignore */ } finally { setBusy(false); }
  }

  async function handleSaveEdit() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const meta = { ...node.metadata };
      if (isCategory(node)) {
        if (description.trim()) meta.description = description.trim();
        else delete meta.description;
      }
      await updateSiteNode(node.id, { title: title.trim(), metadata: meta });
      close();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddCategory() {
    if (!newTitle.trim() || !govType) return;
    setBusy(true);
    setError("");
    try {
      const meta: Record<string, string> = { level: "category", gov_type: govType };
      if (newDescription.trim()) meta.description = newDescription.trim();
      await createSiteNode({
        parentId: node.id,
        slug: toSlug(newTitle),
        title: newTitle.trim(),
        nodeType: "index",
        metadata: meta,
        sortOrder: 999,
      });
      close();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try { await onDelete(); close(); } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div className={`sn-menu${open ? " sn-menu--open" : ""}`} ref={ref}>
      <button className="sn-menu__trigger" onClick={toggle} type="button" aria-label="Options">
        •••
      </button>

      {open && (
        <div className="sn-menu__dropdown">
          {view === "menu" && (
            <>
              {govType && (
                <>
                  <button className="sn-menu__item" onClick={() => setView("add-category")} type="button">
                    Add category
                  </button>
                  <div className="sn-menu__divider" />
                </>
              )}
              <button className="sn-menu__item" onClick={() => setView("edit")} type="button">
                Edit {isCategory(node) ? "name & description" : "name"}
              </button>
              <button className="sn-menu__item" onClick={() => handleMove("up")} disabled={busy || index === 0} type="button">
                Move up
              </button>
              <button className="sn-menu__item" onClick={() => handleMove("down")} disabled={busy || index === siblings.length - 1} type="button">
                Move down
              </button>
              <div className="sn-menu__divider" />
              <button
                className="sn-menu__item sn-menu__item--danger"
                onClick={() => setView("delete-confirm")}
                disabled={!isCategory(node) && node.children.length > 0}
                title={!isCategory(node) && node.children.length > 0 ? "Remove all categories first" : undefined}
                type="button"
              >
                Archive
              </button>
            </>
          )}

          {view === "add-category" && (
            <div className="sn-menu__edit-form">
              <input
                className="sn-menu__input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Category name"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Escape") close(); }}
              />
              <input
                className="sn-menu__input sn-menu__input--secondary"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description (optional)"
                onKeyDown={(e) => { if (e.key === "Escape") close(); }}
              />
              {error && <span className="sn-menu__error">{error}</span>}
              <div className="sn-menu__edit-actions">
                <button className="sn-menu__save-btn" onClick={handleAddCategory} disabled={busy || !newTitle.trim()} type="button">
                  {busy ? "Saving…" : "Add"}
                </button>
                <button className="sn-menu__cancel-btn" onClick={() => setView("menu")} type="button">Cancel</button>
              </div>
            </div>
          )}

          {view === "edit" && (
            <div className="sn-menu__edit-form">
              <input
                className="sn-menu__input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Name"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Escape") close(); }}
              />
              {isCategory(node) && (
                <input
                  className="sn-menu__input sn-menu__input--secondary"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (optional)"
                  onKeyDown={(e) => { if (e.key === "Escape") close(); }}
                />
              )}
              {error && <span className="sn-menu__error">{error}</span>}
              <div className="sn-menu__edit-actions">
                <button className="sn-menu__save-btn" onClick={handleSaveEdit} disabled={busy || !title.trim()} type="button">
                  {busy ? "Saving…" : "Save"}
                </button>
                <button className="sn-menu__cancel-btn" onClick={() => setView("menu")} type="button">Cancel</button>
              </div>
            </div>
          )}

          {view === "delete-confirm" && (
            <div className="sn-menu__edit-form">
              <p className="sn-menu__confirm-text">Archive <strong>{node.title}</strong>?</p>
              <div className="sn-menu__edit-actions">
                <button className="sn-menu__save-btn sn-menu__save-btn--danger" onClick={handleDelete} disabled={busy} type="button">
                  {busy ? "Archiving…" : "Archive"}
                </button>
                <button className="sn-menu__cancel-btn" onClick={() => setView("menu")} type="button">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
