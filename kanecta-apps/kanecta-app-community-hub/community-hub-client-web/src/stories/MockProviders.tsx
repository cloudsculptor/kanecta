import { createContext, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { UserRole } from "../auth/useUserRole";

type MockRole = UserRole | "guest" | "public";

export const MockKeycloakContext = createContext({ initialized: true, authenticated: false });

export function MockKeycloakProvider({ authenticated = false, children }: { authenticated?: boolean; children: ReactNode }) {
  return (
    <MockKeycloakContext.Provider value={{ initialized: true, authenticated }}>
      {children}
    </MockKeycloakContext.Provider>
  );
}

export function StoryWrapper({ role = "team", children }: { role?: MockRole; children: ReactNode }) {
  return (
    <MemoryRouter>
      <MockKeycloakProvider authenticated={role !== "public" && role !== "guest"}>
        {children}
      </MockKeycloakProvider>
    </MemoryRouter>
  );
}
