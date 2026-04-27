import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="site-footer">
      <Link to="/about" className="site-footer__link">
        About this site
      </Link>
      <span className="site-footer__divider" aria-hidden="true">·</span>
      <a
        href="https://github.com/cloudsculptor/featherston"
        target="_blank"
        rel="noopener noreferrer"
        className="site-footer__link"
      >
        Source code (AGPL)
      </a>
    </footer>
  );
}
