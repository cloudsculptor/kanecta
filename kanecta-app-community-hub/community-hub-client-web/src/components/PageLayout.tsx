import { type ReactNode } from "react";
import Header from "./Header";
import Breadcrumb from "./Breadcrumb";
import ComingSoon from "./ComingSoon";
import Footer from "./Footer";
import { usePageMeta } from "../hooks/usePageMeta";

interface PageLayoutProps {
  pageName: string;
  children?: ReactNode;
  showComingSoon?: boolean;
}

export default function PageLayout({
  pageName,
  children,
  showComingSoon = true,
}: PageLayoutProps) {
  usePageMeta(pageName);
  return (
    <>
      <Header />
      <Breadcrumb pageName={pageName} />
      <main className="page-content">
        <h2>{pageName}</h2>
        {showComingSoon && <ComingSoon />}
        {children}
      </main>
      <Footer />
    </>
  );
}
