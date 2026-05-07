import { Link } from "react-router-dom";

interface Crumb {
  name: string;
  path: string;
}

interface BreadcrumbProps {
  pageName: string;
  parents?: Crumb[];
}

export default function Breadcrumb({ pageName, parents }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/" className="breadcrumb__home" aria-label="Home">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
      </Link>
      {parents && parents.map(crumb => (
        <span key={crumb.path} style={{ display: "contents" }}>
          <span className="breadcrumb__separator" aria-hidden="true">›</span>
          <Link to={crumb.path} className="breadcrumb__link">{crumb.name}</Link>
        </span>
      ))}
      <span className="breadcrumb__separator" aria-hidden="true">›</span>
      <span className="breadcrumb__current" aria-current="page">{pageName}</span>
    </nav>
  );
}
