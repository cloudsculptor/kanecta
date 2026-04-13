import { type ReactNode } from "react";
import Header from "./Header";
import Breadcrumb from "./Breadcrumb";
import ComingSoon from "./ComingSoon";

interface PageLayoutProps {
  pageName: string;
  children?: ReactNode;
}

export default function PageLayout({ pageName, children }: PageLayoutProps) {
  return (
    <>
      <Header />
      <Breadcrumb pageName={pageName} />
      <main className="page-content">
        <h2>{pageName}</h2>
        <ComingSoon />
        {children}
      </main>
    </>
  );
}
