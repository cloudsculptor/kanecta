import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    const opts = { auth: { token: keycloak.token }, autoConnect: true };
    socket = BASE ? io(BASE, opts) : io(opts);
  }
  return socket;
}

export function useSocket() {
  return getSocket();
}

export function useThreadSocket(
  threadId: string | null,
  handlers: Record<string, (data: unknown) => void>
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!threadId) return;
    const s = getSocket();
    s.emit("thread:join", threadId);

    const cleanup: Array<() => void> = [];
    for (const [event] of Object.entries(handlersRef.current)) {
      const wrapped = (data: unknown) => handlersRef.current[event]?.(data);
      s.on(event, wrapped);
      cleanup.push(() => s.off(event, wrapped));
    }

    return () => {
      s.emit("thread:leave", threadId);
      cleanup.forEach((fn) => fn());
    };
  }, [threadId]);
}

export function useGlobalSocket(handlers: Record<string, (data: unknown) => void>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const s = getSocket();
    const cleanup: Array<() => void> = [];
    for (const [event] of Object.entries(handlersRef.current)) {
      const wrapped = (data: unknown) => handlersRef.current[event]?.(data);
      s.on(event, wrapped);
      cleanup.push(() => s.off(event, wrapped));
    }
    return () => cleanup.forEach((fn) => fn());
  }, []);
}

export function useRepliesSocket(
  messageId: string | null,
  handlers: Record<string, (data: unknown) => void>
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!messageId) return;
    const s = getSocket();
    s.emit("replies:join", messageId);

    const cleanup: Array<() => void> = [];
    for (const [event] of Object.entries(handlersRef.current)) {
      const wrapped = (data: unknown) => handlersRef.current[event]?.(data);
      s.on(event, wrapped);
      cleanup.push(() => s.off(event, wrapped));
    }

    return () => {
      s.emit("replies:leave", messageId);
      cleanup.forEach((fn) => fn());
    };
  }, [messageId]);
}
