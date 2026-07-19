import { Link } from "react-router-dom";
import Tooltip from "@mui/material/Tooltip";

interface Attribution {
  label: string;
  url: string;
}

export interface NavCardProps {
  title: string;
  blurb: string;
  path: string;
  image?: string;
  attribution?: Attribution;
  featured?: boolean;
  accent?: boolean;
}

export function NavCard({ title, blurb, path, image, attribution, featured, accent }: NavCardProps) {
  const cls = ["nav-card", featured && "nav-card--featured", accent && "nav-card--accent"].filter(Boolean).join(" ");
  return (
    <Link to={path} className={cls}>
      <Tooltip
        title={
          attribution ? (
            <a
              href={attribution.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              {attribution.label}
            </a>
          ) : ""
        }
        enterDelay={1500}
        enterNextDelay={1500}
        disableHoverListener={!attribution}
      >
        <div
          className="nav-card__image"
          style={
            image
              ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
      </Tooltip>
      <div className="nav-card__content">
        <h2 className="nav-card__title">{title}</h2>
        <p className="nav-card__blurb">{blurb}</p>
      </div>
    </Link>
  );
}

export function ComingCard({ title, blurb, image }: { title: string; blurb: string; image?: string }) {
  return (
    <div className="nav-card nav-card--coming">
      <div
        className="nav-card__image"
        style={
          image
            ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      />
      <div className="nav-card__content">
        <h2 className="nav-card__title">{title}</h2>
        <p className="nav-card__blurb">{blurb}</p>
      </div>
    </div>
  );
}
