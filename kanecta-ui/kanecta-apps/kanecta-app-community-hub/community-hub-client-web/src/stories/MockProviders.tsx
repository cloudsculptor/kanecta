import { createContext, useContext, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { UserRole } from "../auth/useUserRole";

type MockRole = UserRole | "guest" | "public";

export const MockKeycloakContext = createContext({ initialized: true, authenticated: false });

// Tracks whether a StoryWrapper (and therefore a MemoryRouter) is already
// mounted above us. Nesting two StoryWrappers — e.g. a meta-level wrapper plus a
// per-story role override — must NOT mount a second <Router>, which React Router
// rejects ("You cannot render a <Router> inside another <Router>"). The
// innermost wrapper still applies its own role, so a story-level override wins.
const InsideStoryWrapper = createContext(false);

export function MockKeycloakProvider({ authenticated = false, children }: { authenticated?: boolean; children: ReactNode }) {
  return (
    <MockKeycloakContext.Provider value={{ initialized: true, authenticated }}>
      {children}
    </MockKeycloakContext.Provider>
  );
}

export function StoryWrapper({ role = "team", children }: { role?: MockRole; children: ReactNode }) {
  const alreadyWrapped = useContext(InsideStoryWrapper);
  const inner = (
    <InsideStoryWrapper.Provider value={true}>
      <MockKeycloakProvider authenticated={role !== "public" && role !== "guest"}>
        {children}
      </MockKeycloakProvider>
    </InsideStoryWrapper.Provider>
  );
  // Only the outermost StoryWrapper mounts the router.
  return alreadyWrapped ? inner : <MemoryRouter>{inner}</MemoryRouter>;
}
