import PageLayout from "../components/PageLayout";

export default function CommunicationNetworks() {
  return (
    <PageLayout pageName="Communication Networks" showComingSoon={false}>
      <h3>Noticeboards</h3>
      <p>
        Physical noticeboards around Featherston are a key way to share
        information with the community, especially during disruptions when
        digital networks may not be available.
      </p>
      <iframe
        src="https://www.google.com/maps/d/embed?mid=1CRFNVgsBvEwENusSirQJJ9YcD90bY9U"
        title="Featherston Noticeboard Locations"
        style={{ width: "100%", height: 480, border: 0, borderRadius: 8, marginTop: 16 }}
        allowFullScreen
        loading="lazy"
      />
      <p style={{ fontSize: 13, marginTop: 8, opacity: 0.6 }}>
        <a
          href="https://www.google.com/maps/d/edit?mid=1CRFNVgsBvEwENusSirQJJ9YcD90bY9U&usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open full map
        </a>
      </p>
    </PageLayout>
  );
}
