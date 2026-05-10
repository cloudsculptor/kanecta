import { useState } from "react";
import { Link } from "react-router-dom";

const ALL_LINKS = [
  { label: "About this site", to: "/about", internal: true },
  { label: "Roadmap", to: "/roadmap", internal: true },
  { label: "Source code (AGPL)", href: "https://github.com/cloudsculptor/featherston" },
  { label: "Emoji: Noto Emoji (Apache 2.0)", href: "https://fonts.google.com/noto/specimen/Noto+Emoji" },
];

export default function Footer() {
  const [showMore, setShowMore] = useState(false);

  return (
    <footer className="site-footer">
      {/* Desktop: show all links inline */}
      {ALL_LINKS.map((link, i) => (
        <span key={link.label} className="site-footer__desktop-only" style={{ display: "contents" }}>
          {i > 0 && <span className="site-footer__divider" aria-hidden="true">·</span>}
          {link.internal
            ? <Link to={link.to!} className="site-footer__link">{link.label}</Link>
            : <a href={link.href} target="_blank" rel="noopener noreferrer" className="site-footer__link">{link.label}</a>}
        </span>
      ))}

      {/* Mobile: About + ··· button */}
      <Link to="/about" className="site-footer__link site-footer__mobile-only">About this site</Link>
      <span className="site-footer__divider site-footer__mobile-only" aria-hidden="true">·</span>
      <button
        className="site-footer__link site-footer__more site-footer__mobile-only"
        onClick={() => setShowMore(true)}
        aria-label="More links"
      >
        ···
      </button>

      {/* Mobile bottom sheet */}
      {showMore && (
        <>
          <div className="site-footer__overlay" onClick={() => setShowMore(false)} />
          <div className="site-footer__sheet">
            <div className="site-footer__sheet-handle" />
            {ALL_LINKS.map((link) => (
              link.internal
                ? <Link key={link.label} to={link.to!} className="site-footer__sheet-link" onClick={() => setShowMore(false)}>{link.label}</Link>
                : <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="site-footer__sheet-link" onClick={() => setShowMore(false)}>{link.label}</a>
            ))}
          </div>
        </>
      )}
    </footer>
  );
}
