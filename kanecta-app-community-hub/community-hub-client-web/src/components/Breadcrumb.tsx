import { Link } from "react-router-dom";

interface BreadcrumbProps {
  pageName: string;
}

export default function Breadcrumb({ pageName }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/" className="breadcrumb__home" aria-label="Home">
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
      </Link>
      <span className="breadcrumb__separator" aria-hidden="true">
        ›
      </span>
      <span className="breadcrumb__current" aria-current="page">
        {pageName}
      </span>
    </nav>
  );
}
