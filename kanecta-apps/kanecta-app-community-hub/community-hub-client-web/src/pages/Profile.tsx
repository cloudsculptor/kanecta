import { useEffect, useState } from "react";
import { Typography, CircularProgress, Alert, Box } from "@mui/material";
import PageLayout from "../components/PageLayout";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getMyTrustChain, type TrustNode } from "../api/trust";

function TrustTree({ chain }: { chain: TrustNode[] }) {
  return (
    <div className="trust-tree">
      {chain.map((node, index) => (
        <div key={node.id} className="trust-tree__node" style={{ paddingLeft: index * 24 }}>
          <div className="trust-tree__connector">
            {index > 0 && <span className="trust-tree__line" />}
            <span className={`trust-tree__name${node.isCurrentUser ? " trust-tree__name--you" : ""}`}>
              {node.isCurrentUser ? `${node.name} (you)` : node.name}
            </span>
          </div>
          {node.trustedBy?.reason && (
            <div className="trust-tree__reason" style={{ paddingLeft: 16 }}>
              {node.trustedBy.reason}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Profile() {
  const { authenticated } = useKeycloak();
  const [chain, setChain] = useState<TrustNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    getMyTrustChain()
      .then(setChain)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [authenticated]);

  return (
    <PageLayout pageName="Profile" showComingSoon={false}>
      {authenticated && (
        <section>
          <Typography variant="h6" sx={{ mb: 1 }}>Tree of Trust</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The chain of people who vouch for your membership.
          </Typography>

          {loading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            </Box>
          )}

          {error && (
            <Alert severity="error">Could not load your trust chain.</Alert>
          )}

          {!loading && !error && chain.length === 0 && (
            <Alert severity="info">No trust record found for your account.</Alert>
          )}

          {!loading && !error && chain.length > 0 && (
            <TrustTree chain={chain} />
          )}
        </section>
      )}
    </PageLayout>
  );
}
