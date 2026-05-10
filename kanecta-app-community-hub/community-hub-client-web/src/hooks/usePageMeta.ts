import { useEffect } from "react";

export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title === "Featherston" ? "Featherston" : `${title} — Featherston`;
    if (description) {
      const meta = document.querySelector('meta[name="description"]');
      meta?.setAttribute("content", description);
    }
  }, [title, description]);
}
