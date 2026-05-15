import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";

export default function TeamRequired() {
  return (
    <div>
      <Header />
      <Breadcrumb pageName="Discussions" />
      <div style={{ maxWidth: 560, margin: "3rem auto", padding: "0 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Team access required</h1>
        <p style={{ color: "var(--text)", lineHeight: 1.6 }}>
          Discussions are only available to Featherston team members. If you'd like to get involved,
          reach out and we can get you added.
        </p>
      </div>
      <Footer />
    </div>
  );
}
