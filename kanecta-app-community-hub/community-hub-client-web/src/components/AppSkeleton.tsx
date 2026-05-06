import LandscapeIcon from "@mui/icons-material/Landscape";

export default function AppSkeleton() {
  return (
    <div className="app-skeleton">
      <div className="app-skeleton__header">
        <div className="app-skeleton__brand">
          <LandscapeIcon sx={{ fontSize: 26, color: "rgba(255,255,255,0.85)", flexShrink: 0 }} />
          <span className="app-skeleton__site-name">Featherston</span>
        </div>
        <div className="app-skeleton__header-right">
          <div className="app-skeleton__shimmer app-skeleton__shimmer--btn" />
          <div className="app-skeleton__shimmer app-skeleton__shimmer--btn app-skeleton__shimmer--btn-wide" />
        </div>
      </div>

      <div className="app-skeleton__grid">
        {/* Featured wide card */}
        <div className="app-skeleton__card app-skeleton__card--wide">
          <div className="app-skeleton__shimmer app-skeleton__card-image" />
          <div className="app-skeleton__card-body">
            <div className="app-skeleton__shimmer app-skeleton__line app-skeleton__line--title" />
            <div className="app-skeleton__shimmer app-skeleton__line" />
          </div>
        </div>
        {/* Regular cards */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="app-skeleton__card">
            <div className="app-skeleton__shimmer app-skeleton__card-image" />
            <div className="app-skeleton__card-body">
              <div className="app-skeleton__shimmer app-skeleton__line app-skeleton__line--title" />
              <div className="app-skeleton__shimmer app-skeleton__line" />
              <div className="app-skeleton__shimmer app-skeleton__line app-skeleton__line--short" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
