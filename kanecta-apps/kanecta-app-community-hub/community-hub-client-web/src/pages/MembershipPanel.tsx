import { useEffect, useState } from "react";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import PageLayout from "../components/PageLayout";
import { useUserRoles } from "../auth/useUserRole";
import { getMembers, addToTeam, type Member } from "../api/members";

const PARENTS = [{ name: "Governance", path: "/governance" }];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  team: "Team",
  moderator: "Moderator",
  treasurer: "Treasurer",
  resilience: "Resilience",
};

const ROLE_COLOURS: Record<string, "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info"> = {
  admin: "warning",
  team: "primary",
  moderator: "error",
  treasurer: "success",
  resilience: "info",
};

export default function MembershipPanel() {
  const roles = useUserRoles();
  const isAdmin = roles.includes("admin");

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [promoting, setPromoting] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    getMembers()
      .then(setMembers)
      .catch((err: Error) => setError(`Failed to load members: ${err.message}`))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <PageLayout pageName="Membership" showComingSoon={false} parents={PARENTS}>
        <p>You don't have permission to view this page.</p>
      </PageLayout>
    );
  }

  const byName = (a: Member, b: Member) => (a.name || a.username).localeCompare(b.name || b.username);
  const pending = members.filter(m => m.roles.length === 0).sort(byName);
  const active = members.filter(m => m.roles.length > 0).sort(byName);

  async function handleAddToTeam(member: Member) {
    setPromoting(member.id);
    try {
      await addToTeam(member.id);
      setMembers(ms =>
        ms.map(m =>
          m.id === member.id ? { ...m, roles: [...m.roles, "team"] } : m
        )
      );
    } catch {
      setError(`Failed to add ${member.name} to team.`);
    } finally {
      setPromoting(null);
    }
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
                promoting={promoting}
                onAddToTeam={handleAddToTeam}
                showAddToTeam
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
                promoting={promoting}
                onAddToTeam={handleAddToTeam}
                showAddToTeam={false}
              />
            )}
          </section>
        </>
      )}
    </PageLayout>
  );
}

interface MemberTableProps {
  members: Member[];
  promoting: string | null;
  onAddToTeam: (member: Member) => void;
  showAddToTeam: boolean;
}

function MemberTable({ members, promoting, onAddToTeam, showAddToTeam }: MemberTableProps) {
  return (
    <div className="membership-table-wrap">
      <table className="membership-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Joined</th>
            <th>Groups</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map(member => (
            <tr key={member.id}>
              <td>{member.name || member.username}</td>
              <td>{member.email || "—"}</td>
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
              <td>
                {(showAddToTeam || !member.roles.includes("team")) && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={promoting === member.id || member.roles.includes("team")}
                    onClick={() => onAddToTeam(member)}
                  >
                    {promoting === member.id ? "Adding…" : "Add to Team"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
