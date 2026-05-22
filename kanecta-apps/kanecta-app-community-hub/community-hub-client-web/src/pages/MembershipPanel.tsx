import { useEffect, useState } from "react";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import PageLayout from "../components/PageLayout";
import { useUserRole } from "../auth/useUserRole";
import { getMembers, addToTeam, type Member } from "../api/members";

const PARENTS = [{ name: "Governance", path: "/governance" }];

const ROLE_LABELS: Record<string, string> = {
  team: "Team",
  moderator: "Moderator",
  treasurer: "Treasurer",
  resilience: "Resilience",
};

const ROLE_COLOURS: Record<string, "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info"> = {
  team: "primary",
  moderator: "error",
  treasurer: "success",
  resilience: "info",
};

export default function MembershipPanel() {
  const role = useUserRole();
  const isModerator = role === "MODERATOR";

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [promoting, setPromoting] = useState<string | null>(null);

  useEffect(() => {
    if (!isModerator) return;
    getMembers()
      .then(setMembers)
      .catch((err: Error) => setError(`Failed to load members: ${err.message}`))
      .finally(() => setLoading(false));
  }, [isModerator]);

  if (!isModerator) {
    return (
      <PageLayout pageName="Membership" showComingSoon={false} parents={PARENTS}>
        <p>You don't have permission to view this page.</p>
      </PageLayout>
    );
  }

  const pending = members.filter(m => m.roles.length === 0);
  const active = members.filter(m => m.roles.length > 0);

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
            <th>Groups</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map(member => (
            <tr key={member.id}>
              <td>{member.name || member.username}</td>
              <td>{member.email || "—"}</td>
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
