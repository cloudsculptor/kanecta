import { type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Header from "./Header";
import Breadcrumb from "./Breadcrumb";

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
        <Alert severity="info" sx={{ mb: 3 }}>
          Content coming soon
        </Alert>
        {children}
      </main>
    </>
  );
}
