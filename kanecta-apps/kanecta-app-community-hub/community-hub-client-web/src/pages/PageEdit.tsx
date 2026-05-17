import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import ListSubheader from "@mui/material/ListSubheader";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPage, createPage, updatePage } from "../api/pages";
import { listLicences, type Licence } from "../api/licences";
import LexicalEditor from "../components/pages/LexicalEditor";
import keycloak from "../auth/keycloak";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const GROUP_NAME = "Resilience Group";

const breadcrumbParents = [{ name: "Groups", path: "/groups" }];

function currentUserName(): string {
  const p = keycloak.tokenParsed as Record<string, string> | undefined;
  if (!p) return "";
  return [p.given_name, p.family_name].filter(Boolean).join(" ") || p.preferred_username || "";
}

function defaultLicenceId(list: Licence[]): string {
  return list.find((l) => !l.name.startsWith("CC "))?.id ?? "";
}

function compositeFromPage(list: Licence[], licenceId: string | null): string {
  if (!licenceId) return defaultLicenceId(list);
  const isCC = list.find((l) => l.id === licenceId)?.name.startsWith("CC ");
  return isCC ? `${licenceId}:group` : licenceId;
}

function rawLicenceId(composite: string): string | null {
  return composite ? composite.split(":")[0] : null;
}

export default function PageEdit() {
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const isNew = !routeSlug;

  const role = useUserRole();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [initialContent, setInitialContent] = useState<object | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [slugError, setSlugError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const [licences, setLicences] = useState<Licence[]>([]);
  const [licenceId, setLicenceId] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [ownerType, setOwnerType] = useState<string>("private");
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPublic, setPendingPublic] = useState(false);

  const contentRef = useRef<object>({});
  const originalSlugRef = useRef("");

  const isTeam = role === "TEAM" || role === "MODERATOR";
  const userName = currentUserName();
  const year = new Date().getFullYear();

  const ccLicences = licences.filter((l) => l.name.startsWith("CC "));
  const publicDomainLicences = licences.filter((l) => !l.name.startsWith("CC "));

  useEffect(() => {
    if (!initialized) return;
    if (!isTeam) { navigate("/", { replace: true }); return; }

    if (isNew) {
      listLicences()
        .then((list) => {
          setLicences(list);
          setLicenceId(defaultLicenceId(list));
        })
        .catch(() => {});
      return;
    }

    Promise.all([listLicences(), getPage(routeSlug!)])
      .then(([list, page]) => {
        setLicences(list);
        setSlug(page.slug);
        setTitle(page.title);
        setInitialContent(page.content_json);
        contentRef.current = page.content_json;
        originalSlugRef.current = page.slug;
        setIsPublic(page.public);
        setOwnerType(page.owner_type);
        setOwnerId(page.owner_id);
        setLicenceId(compositeFromPage(list, page.licence_id));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, isTeam, isNew, routeSlug, navigate]);

  function markDirty() { setIsDirty(true); }

  function handleSlugChange(value: string) {
    const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlug(clean);
    markDirty();
    if (clean && !SLUG_RE.test(clean)) {
      setSlugError("Slugs must start and end with a letter or number");
    } else {
      setSlugError("");
    }
  }

  function handleTogglePublic() {
    setPendingPublic(!isPublic);
    setConfirmOpen(true);
  }

  function handleConfirmToggle() {
    setIsPublic(pendingPublic);
    setIsDirty(true);
    setConfirmOpen(false);
  }

  function handleCancelToggle() {
    setConfirmOpen(false);
  }

  function handleHistoryClick(e: React.MouseEvent) {
    if (isDirty && !window.confirm("You have unsaved changes. Leave anyway?")) {
      e.preventDefault();
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!SLUG_RE.test(slug)) { setSlugError("Invalid slug"); return; }
    setSaving(true);
    setError("");
    try {
      const lid = rawLicenceId(licenceId);
      if (isNew) {
        await createPage({
          slug,
          title,
          content_json: contentRef.current,
          licence_id: lid,
          owner_type: ownerType,
          owner_id: ownerId,
        });
      } else {
        await updatePage(originalSlugRef.current, {
          slug: slug !== originalSlugRef.current ? slug : undefined,
          title,
          content_json: contentRef.current,
          licence_id: lid,
          public: isPublic,
          owner_type: ownerType,
          owner_id: ownerId,
        });
      }
      setIsDirty(false);
      navigate("/groups/resilience");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header />
        <Breadcrumb pageName="Resilience" parents={breadcrumbParents} />
        <main className="page-content"><p>Loading…</p></main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <Breadcrumb pageName="Resilience" parents={breadcrumbParents} />
      <main className="page-content page-edit">
        {error && <p className="pages-error">{error}</p>}
        {uploadError && <p className="pages-error">{uploadError} <button type="button" onClick={() => setUploadError("")}>✕</button></p>}
        <form onSubmit={handleSave} className="page-edit__form">
          <input
            className="page-edit__title-input"
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); markDirty(); }}
            placeholder="Page title"
          />

          <div className="page-edit__field">
            <label className="page-edit__label" htmlFor="pe-slug">
              Page path
              <span className="page-edit__hint"> (a–z, 0–9, hyphens)</span>
            </label>
            <div className="page-edit__slug-preview">
              <span className="page-edit__slug-prefix">/groups/resilience/</span>
              <input
                id="pe-slug"
                className={`page-edit__input${slugError ? " page-edit__input--error" : ""}`}
                type="text"
                value={slug}
                required
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="my-page-name"
              />
            </div>
            {slugError && <p className="page-edit__field-error">{slugError}</p>}
          </div>

          <div className="page-edit__field">
            <label className="page-edit__label">Content</label>
            <LexicalEditor
              initialState={initialContent}
              onChange={(state) => { contentRef.current = state; markDirty(); }}
              onUploadError={(msg) => setUploadError(msg)}
            />
          </div>

          <div className="page-edit__field page-edit__publishing">
            <h3 className="page-edit__section-heading">Publishing</h3>

            <FormControlLabel
              control={
                <Switch
                  checked={isPublic}
                  onChange={handleTogglePublic}
                  color="success"
                />
              }
              label={isPublic ? "Public" : "Private"}
            />

            <FormControl fullWidth size="small" sx={{ mt: 2 }}>
              <InputLabel id="pe-licence-label">Licence</InputLabel>
              <Select
                labelId="pe-licence-label"
                value={licenceId}
                label="Licence"
                onChange={(e) => { setLicenceId(e.target.value); markDirty(); }}
                renderValue={(val) => {
                  const [id, ctx] = (val as string).split(":");
                  const l = licences.find((x) => x.id === id);
                  if (!l) return "";
                  if (ctx === "group") return `${l.name}  © ${year} ${GROUP_NAME}`;
                  if (ctx === "user") return `${l.name}  © ${year} ${userName}`;
                  return l.name;
                }}
              >
                <ListSubheader>— Public domain —</ListSubheader>
                {publicDomainLicences.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    <div className="page-edit__licence-option">
                      <div className="page-edit__licence-option-name">
                        <span>{l.name}</span>
                        {l.badge && (
                          <Chip label={l.badge} color="success" size="small" sx={{ ml: 1 }} />
                        )}
                      </div>
                      {l.public_description && (
                        <div className="page-edit__licence-option-desc">{l.public_description}</div>
                      )}
                    </div>
                  </MenuItem>
                ))}

                <ListSubheader>— {GROUP_NAME} —</ListSubheader>
                {ccLicences.map((l) => (
                  <MenuItem key={`${l.id}:group`} value={`${l.id}:group`}>
                    <div className="page-edit__licence-option">
                      <div className="page-edit__licence-option-name">
                        <span>{l.name}  © {year} {GROUP_NAME}</span>
                      </div>
                      {l.public_description && (
                        <div className="page-edit__licence-option-desc">{l.public_description}</div>
                      )}
                    </div>
                  </MenuItem>
                ))}

                <ListSubheader>— {userName} —</ListSubheader>
                {ccLicences.map((l) => (
                  <MenuItem key={`${l.id}:user`} value={`${l.id}:user`}>
                    <div className="page-edit__licence-option">
                      <div className="page-edit__licence-option-name">
                        <span>{l.name}  © {year} {userName}</span>
                      </div>
                      {l.public_description && (
                        <div className="page-edit__licence-option-desc">{l.public_description}</div>
                      )}
                    </div>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {!isNew && (
              <div className="page-edit__history-link">
                <Link to={`/groups/resilience/${slug}/history`} onClick={handleHistoryClick}>
                  View page history
                </Link>
              </div>
            )}

            <div className="page-edit__copyright">
              <p>© {year} {GROUP_NAME}</p>
            </div>
          </div>

          <div className="page-edit__actions">
            <button type="submit" className="page-edit__save" disabled={saving || !!slugError}>
              {saving ? "Saving…" : "Save page"}
            </button>
            <button type="button" className="page-edit__cancel" onClick={() => navigate("/groups/resilience")}>
              Cancel
            </button>
          </div>
        </form>
      </main>

      <Dialog open={confirmOpen} onClose={handleCancelToggle}>
        <DialogTitle>
          {pendingPublic ? "Make this page public?" : "Make this page private?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pendingPublic
              ? "The page will be marked as public in the database. Actual internet visibility is managed separately."
              : "The page will be marked as private. It will no longer be flagged as public."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelToggle}>Cancel</Button>
          <Button onClick={handleConfirmToggle} variant="contained" color={pendingPublic ? "success" : "warning"}>
            {pendingPublic ? "Make public" : "Make private"}
          </Button>
        </DialogActions>
      </Dialog>

      <Footer />
    </>
  );
}
