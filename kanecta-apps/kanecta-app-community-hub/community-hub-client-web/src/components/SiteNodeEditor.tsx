import { useState } from "react";
import { createSiteNode, updateSiteNode, type SiteNode } from "../api/site-nodes";

function toSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RenameProps {
  mode: "rename";
  node: SiteNode;
  onSaved: () => void;
}

interface AddGroupProps {
  mode: "add-group";
  parentNode?: SiteNode;
  onSaved: () => void;
}

interface AddCategoryProps {
  mode: "add-category";
  parentNode: SiteNode;
  govType: "procedure" | "policy";
  onSaved: () => void;
}

type Props = RenameProps | AddGroupProps | AddCategoryProps;

export default function SiteNodeEditor(props: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.mode === "rename" ? props.node.title : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (props.mode === "rename") {
        await updateSiteNode(props.node.id, { title: title.trim() });
      } else if (props.mode === "add-group") {
        await createSiteNode({
          parentId: props.parentNode?.id ?? null,
          slug: toSlug(title),
          title: title.trim(),
          nodeType: "index",
          metadata: { level: "group" },
          sortOrder: 999,
        });
      } else {
        const slug = toSlug(title);
        await createSiteNode({
          parentId: props.parentNode.id,
          slug,
          title: title.trim(),
          nodeType: "index",
          metadata: {
            level: "category",
            gov_type: props.govType,
          },
          sortOrder: 999,
        });
      }
      setOpen(false);
      setTitle(props.mode === "rename" ? props.node.title : "");
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    const label =
      props.mode === "rename"
        ? "✎"
        : props.mode === "add-group"
          ? "+ Add group"
          : "+ Add category";
    const className =
      props.mode === "rename"
        ? "site-node-editor__rename-btn"
        : "site-node-editor__add-btn";
    return (
      <button className={className} onClick={() => setOpen(true)} type="button">
        {label}
      </button>
    );
  }

  const placeholder =
    props.mode === "rename"
      ? "Group or category name"
      : props.mode === "add-group"
        ? "New group name"
        : "New category name";

  return (
    <div className="site-node-editor">
      <input
        className="site-node-editor__input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") {
            setOpen(false);
            setTitle(props.mode === "rename" ? props.node.title : "");
          }
        }}
      />
      <button
        className="site-node-editor__save-btn"
        onClick={handleSave}
        disabled={saving || !title.trim()}
        type="button"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        className="site-node-editor__cancel-btn"
        onClick={() => {
          setOpen(false);
          setTitle(props.mode === "rename" ? props.node.title : "");
        }}
        type="button"
      >
        Cancel
      </button>
      {error && <span className="site-node-editor__error">{error}</span>}
    </div>
  );
}
