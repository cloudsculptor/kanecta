import { type ReactNode } from "react";
import Header from "./Header";
import Breadcrumb from "./Breadcrumb";
import ComingSoon from "./ComingSoon";
import Footer from "./Footer";
import { usePageMeta } from "../hooks/usePageMeta";

interface Crumb {
  name: string;
  path: string;
}

interface PageLayoutProps {
  pageName: string;
  children?: ReactNode;
  showComingSoon?: boolean;
  parents?: Crumb[];
}

export default function PageLayout({
  pageName,
  children,
  showComingSoon = true,
  parents,
}: PageLayoutProps) {
  usePageMeta(pageName);
  return (
    <>
      <Header />
      <Breadcrumb pageName={pageName} parents={parents} />
      <main className="page-content">
        <h2>{pageName}</h2>
        {showComingSoon && <ComingSoon />}
        {children}
      </main>
      <Footer />
    </>
  );
}
