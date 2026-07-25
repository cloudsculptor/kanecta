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

const showDescription = (props: Props) =>
  props.mode === "add-category" ||
  (props.mode === "rename" && props.node.metadata.level === "category");

export default function SiteNodeEditor(props: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.mode === "rename" ? props.node.title : "");
  const [description, setDescription] = useState(
    props.mode === "rename" ? (props.node.metadata.description ?? "") : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setTitle(props.mode === "rename" ? props.node.title : "");
    setDescription(props.mode === "rename" ? (props.node.metadata.description ?? "") : "");
    setOpen(false);
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (props.mode === "rename") {
        const meta = { ...props.node.metadata };
        if (description.trim()) meta.description = description.trim();
        else delete meta.description;
        await updateSiteNode(props.node.id, { title: title.trim(), metadata: meta });
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
        const meta: Record<string, string> = { level: "category", gov_type: props.govType };
        if (description.trim()) meta.description = description.trim();
        await createSiteNode({
          parentId: props.parentNode.id,
          slug: toSlug(title),
          title: title.trim(),
          nodeType: "index",
          metadata: meta,
          sortOrder: 999,
        });
      }
      reset();
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    const label =
      props.mode === "rename" ? "✎" : props.mode === "add-group" ? "+ Add group" : "+ Add category";
    const className =
      props.mode === "rename" ? "site-node-editor__rename-btn" : "site-node-editor__add-btn";
    return (
      <button className={className} onClick={() => setOpen(true)} type="button">
        {label}
      </button>
    );
  }

  const titlePlaceholder =
    props.mode === "rename"
      ? "Group or category name"
      : props.mode === "add-group"
        ? "New group name"
        : "New category name";

  return (
    <div className="site-node-editor">
      <div className="site-node-editor__fields">
        <input
          className="site-node-editor__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") reset();
          }}
        />
        {showDescription(props) && (
          <input
            className="site-node-editor__input site-node-editor__input--description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            onKeyDown={(e) => {
              if (e.key === "Escape") reset();
            }}
          />
        )}
      </div>
      <div className="site-node-editor__actions">
        <button
          className="site-node-editor__save-btn"
          onClick={handleSave}
          disabled={saving || !title.trim()}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="site-node-editor__cancel-btn" onClick={reset} type="button">
          Cancel
        </button>
        {error && <span className="site-node-editor__error">{error}</span>}
      </div>
    </div>
  );
}
