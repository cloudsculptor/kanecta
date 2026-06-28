import { useEffect, useState } from "react";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  FormGroup, FormControlLabel, Checkbox, RadioGroup, Radio,
  FormControl, FormLabel, TextField, Alert,
} from "@mui/material";
import PageLayout from "../components/PageLayout";
import { useUserRoles } from "../auth/useUserRole";
import {
  getMembers, getPendingMembers, getActiveMembers, addToTeam,
  type Member, type TrustPayload,
} from "../api/members";

const PARENTS = [{ name: "Governance", path: "/governance" }];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  team: "Team",
  moderator: "Moderator",
  treasurer: "Treasurer",
  resilience: "Resilience",
  tester: "Tester",
};

const ROLE_COLOURS: Record<string, "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info"> = {
  admin: "warning",
  team: "primary",
  moderator: "error",
  treasurer: "success",
  resilience: "info",
  tester: "secondary",
};

interface TrustDialogProps {
  member: Member | null;
  onClose: () => void;
  onConfirmed: (member: Member, trust: TrustPayload) => Promise<void>;
}

function TrustDialog({ member, onClose, onConfirmed }: TrustDialogProps) {
  const [knowPersonally, setKnowPersonally] = useState(false);
  const [trustedBySomeone, setTrustedBySomeone] = useState(false);
  const [resilienceHui, setResilienceHui] = useState(false);
  const [other, setOther] = useState(false);
  const [otherReason, setOtherReason] = useState("");
  const [locality, setLocality] = useState<"local" | "supporter" | "">("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKnowPersonally(false); setTrustedBySomeone(false); setResilienceHui(false);
    setOther(false); setOtherReason(""); setLocality("local"); setBusy(false); setError(null);
  }

  function handleClose() {
    if (!busy) { reset(); onClose(); }
  }

  const anyReason = knowPersonally || trustedBySomeone || resilienceHui || (other && otherReason.trim().length > 0);
  const canConfirm = anyReason && locality !== "";

  async function handleConfirm() {
    if (!member || !canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirmed(member, {
        know_personally: knowPersonally,
        trusted_by_someone: trustedBySomeone,
        resilience_hui: resilienceHui,
        other_reason: other ? otherReason.trim() || null : null,
        locality: locality as "local" | "supporter",
      });
      reset();
    } catch {
      setError("Failed to trust member. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog open={member !== null} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Trust {member?.name || member?.username}?</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <FormControl component="fieldset" fullWidth sx={{ mb: 3 }}>
          <FormLabel component="legend" sx={{ mb: 1 }}>
            I confirm that I know this person or someone I trust knows them. How?
          </FormLabel>
          <FormGroup>
            <FormControlLabel
              control={<Checkbox checked={knowPersonally} onChange={(e) => setKnowPersonally(e.target.checked)} />}
              label="I know them personally"
            />
            <FormControlLabel
              control={<Checkbox checked={trustedBySomeone} onChange={(e) => setTrustedBySomeone(e.target.checked)} />}
              label="Somebody I trust knows them"
            />
            <FormControlLabel
              control={<Checkbox checked={resilienceHui} onChange={(e) => setResilienceHui(e.target.checked)} />}
              label="They have come to a Resilience Hui"
            />
            <FormControlLabel
              control={<Checkbox checked={other} onChange={(e) => setOther(e.target.checked)} />}
              label="Other"
            />
            {other && (
              <TextField
                label="Please describe"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                multiline
                minRows={4}
                sx={{ mt: 1, ml: 4, width: "60%" }}
                autoFocus
              />
            )}
          </FormGroup>
        </FormControl>

        <FormControl component="fieldset" fullWidth>
          <FormLabel component="legend" sx={{ mb: 1 }}>Where are they based?</FormLabel>
          <RadioGroup
            value={locality}
            onChange={(e) => setLocality(e.target.value as "local" | "supporter")}
            row
          >
            <FormControlLabel value="local" control={<Radio />} label="Local" />
            <FormControlLabel value="supporter" control={<Radio />} label="Supporter from outside the Featherston ward" />
          </RadioGroup>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!canConfirm || busy}>
          {busy ? "Trusting…" : "Trust"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MembershipPanel() {
  const roles = useUserRoles();
  const isAdmin = roles.includes("admin");
  const isModerator = roles.includes("moderator");
  const canAccess = isAdmin || isModerator;

  const [pending, setPending] = useState<Member[]>([]);
  const [active, setActive] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trustingMember, setTrustingMember] = useState<Member | null>(null);

  const byName = (a: Member, b: Member) => (a.name || a.username).localeCompare(b.name || b.username);

  useEffect(() => {
    if (!canAccess) return;

    if (isAdmin) {
      getMembers()
        .then((members) => {
          setPending(members.filter(m => m.roles.length === 0).sort(byName));
          setActive(members.filter(m => m.roles.length > 0).sort(byName));
        })
        .catch((err: Error) => setError(`Failed to load members: ${err.message}`))
        .finally(() => setLoading(false));
    } else {
      Promise.all([getPendingMembers(), getActiveMembers()])
        .then(([p, a]) => {
          setPending(p.sort(byName));
          setActive(a.sort(byName));
        })
        .catch((err: Error) => setError(`Failed to load members: ${err.message}`))
        .finally(() => setLoading(false));
    }
  }, [canAccess, isAdmin]);

  if (!canAccess) {
    return (
      <PageLayout pageName="Membership" showComingSoon={false} parents={PARENTS}>
        <p>You don't have permission to view this page.</p>
      </PageLayout>
    );
  }

  async function handleTrustConfirmed(member: Member, trust: TrustPayload) {
    await addToTeam(member.id, trust);
    setPending(prev => prev.filter(m => m.id !== member.id));
    setActive(prev => [...prev, { ...member, roles: [...member.roles, "team"] as any }].sort(byName));
    setTrustingMember(null);
  }

  return (
    <PageLayout pageName="Membership" showComingSoon={false} parents={PARENTS}>
      {error && <p className="membership-error">{error}</p>}
      {loading ? (
        <p>Loading members…</p>
      ) : (
        <>
          <section className="membership-section">
            <h3>
              New sign-ups
              <span className="membership-count">{pending.length}</span>
            </h3>
            {pending.length === 0 ? (
              <p className="membership-empty">No pending sign-ups.</p>
            ) : (
              <MemberTable
                members={pending}
                showEmail={true}
                showTrust
                onTrust={(m) => setTrustingMember(m)}
              />
            )}
          </section>

          <section className="membership-section">
            <h3>
              Members
              <span className="membership-count">{active.length}</span>
            </h3>
            {active.length === 0 ? (
              <p className="membership-empty">No members yet.</p>
            ) : (
              <MemberTable
                members={active}
                showEmail={isAdmin}
                showTrust={false}
                onTrust={() => {}}
              />
            )}
          </section>
        </>
      )}

      <TrustDialog
        member={trustingMember}
        onClose={() => setTrustingMember(null)}
        onConfirmed={handleTrustConfirmed}
      />
    </PageLayout>
  );
}

interface MemberTableProps {
  members: Member[];
  showEmail: boolean;
  showTrust: boolean;
  onTrust: (member: Member) => void;
}

function MemberTable({ members, showEmail, showTrust, onTrust }: MemberTableProps) {
  return (
    <div className="membership-table-wrap">
      <table className="membership-table">
        <thead>
          <tr>
            <th>Name</th>
            {showEmail && <th>Email</th>}
            <th>Joined</th>
            <th>Groups</th>
            {showTrust && <th></th>}
          </tr>
        </thead>
        <tbody>
          {members.map(member => (
            <tr key={member.id}>
              <td>{member.name || member.username}</td>
              {showEmail && <td>{member.email || "—"}</td>}
              <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem", color: "var(--text)" }}>
                {member.createdTimestamp
                  ? new Date(member.createdTimestamp).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })
                  : "—"}
              </td>
              <td>
                <span className="membership-roles">
                  {member.roles.length === 0 ? (
                    <span className="membership-no-roles">None</span>
                  ) : (
                    member.roles.map(r => (
                      <Chip
                        key={r}
                        label={ROLE_LABELS[r] ?? r}
                        color={ROLE_COLOURS[r] ?? "default"}
                        size="small"
                      />
                    ))
                  )}
                </span>
              </td>
              {showTrust && (
                <td>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={member.roles.includes("team")}
                    onClick={() => onTrust(member)}
                  >
                    Trust
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
