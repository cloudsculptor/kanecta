import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";

const threads = [
  { id: "general", name: "General", preview: "Morning everyone!" },
  { id: "events", name: "Events", preview: "Saturday market is on" },
  { id: "transport", name: "Transport & Rides", preview: "Two seats free to Wellington" },
  { id: "resilience", name: "Resilience", preview: "Meeting notes posted" },
  { id: "help", name: "Local Help", preview: "Looking for a plumber" },
  { id: "website", name: "Website", preview: "Ideas and feedback for this site" },
];

const messages: Record<string, { author: string; time: string; text: string }[]> = {
  general: [
    { author: "Aroha T.", time: "9:04 am", text: "Morning everyone! Hope you all have a great day." },
    { author: "Mike R.", time: "9:17 am", text: "Anyone know if the library is open today?" },
    { author: "Sarah K.", time: "9:32 am", text: "Yes, opens at 10 I think." },
  ],
  events: [
    { author: "David L.", time: "Yesterday", text: "The Saturday market is on — starts at 8am outside the town hall." },
    { author: "Jenny W.", time: "Yesterday", text: "Amazing, I'll bring my preserves along." },
  ],
  transport: [
    { author: "Tom B.", time: "8:45 am", text: "Heading to Wellington Friday around 7:30am, two seats free if anyone needs a ride." },
    { author: "Priya M.", time: "8:52 am", text: "That would be perfect, can I grab one?" },
    { author: "Tom B.", time: "8:55 am", text: "Of course! Message me your address." },
  ],
  resilience: [
    { author: "Council Rep", time: "Tuesday", text: "Notes from last week's resilience planning meeting are now posted on the Resilience page." },
  ],
  help: [
    { author: "Graham F.", time: "10:12 am", text: "Looking for a good plumber — anyone have a recommendation?" },
    { author: "Liz H.", time: "10:34 am", text: "Try John at Wairarapa Plumbing, he's great and local." },
  ],
  website: [
    { author: "Aroha T.", time: "Yesterday", text: "Love the new look — great work everyone!" },
    { author: "Mike R.", time: "Yesterday", text: "Would be great to have a calendar view for events." },
  ],
};

export default function Discussions() {
  const role = useUserRole();
  const navigate = useNavigate();
  const [activeThread, setActiveThread] = useState("general");
  const thread = threads.find((t) => t.id === activeThread)!;

  useEffect(() => {
    if (role === "PUBLIC") navigate("/", { replace: true });
    else if (role === "LOCAL" || role === "RESILIENCE") navigate("/discussions/team-required", { replace: true });
  }, [role, navigate]);

  if (role !== "TEAM" && role !== "MODERATOR") return null;

  return (
    <div className="discussions-page">
      <Header />
      <Breadcrumb pageName="Discussions" />
      <div className="discussions-layout">
        <aside className="discussions-sidebar">
          <div className="discussions-sidebar__heading">Threads</div>
          <ul className="discussions-sidebar__list">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  className={`discussions-thread-item${t.id === activeThread ? " discussions-thread-item--active" : ""}`}
                  onClick={() => setActiveThread(t.id)}
                >
                  <span className="discussions-thread-item__hash">#</span>
                  <span className="discussions-thread-item__name">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="discussions-main">
          <div className="discussions-main__header">
            <span className="discussions-main__hash">#</span>
            {thread.name}
          </div>
          <div className="discussions-main__messages">
            {messages[activeThread].map((msg, i) => (
              <div key={i} className="discussions-message">
                <div className="discussions-message__avatar">
                  {msg.author[0]}
                </div>
                <div className="discussions-message__body">
                  <div className="discussions-message__meta">
                    <span className="discussions-message__author">{msg.author}</span>
                    <span className="discussions-message__time">{msg.time}</span>
                  </div>
                  <p className="discussions-message__text">{msg.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="discussions-main__input">
            <input
              type="text"
              placeholder={`Message #${thread.name.toLowerCase()}`}
              disabled
            />
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
