import { createContext, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { UserRole } from "../auth/useUserRole";

export const MockKeycloakContext = createContext({ initialized: true, authenticated: false });

export function MockKeycloakProvider({ authenticated = false, children }: { authenticated?: boolean; children: ReactNode }) {
  return (
    <MockKeycloakContext.Provider value={{ initialized: true, authenticated }}>
      {children}
    </MockKeycloakContext.Provider>
  );
}

export function StoryWrapper({ role = "TEAM", children }: { role?: UserRole; children: ReactNode }) {
  return (
    <MemoryRouter>
      <MockKeycloakProvider authenticated={role !== "PUBLIC"}>
        {children}
      </MockKeycloakProvider>
    </MemoryRouter>
  );
}
