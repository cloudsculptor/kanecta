import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { pushApi } from "../api/push";
import { useNativePush } from "./useNativePush";

export type PushDeviceStatus = "unsupported" | "denied" | "subscribed" | "unsubscribed";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function useWebPush(): { status: PushDeviceStatus; subscribe: () => Promise<void>; unsubscribe: () => Promise<void> } {
  const [status, setStatus] = useState<PushDeviceStatus>("unsubscribed");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "subscribed" : "unsubscribed");
    });
  }, []);

  async function subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "") as unknown as string,
    });
    await pushApi.saveDevice(sub);
    setStatus("subscribed");
  }

  async function unsubscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await pushApi.removeDevice(sub.endpoint);
      await sub.unsubscribe();
    }
    setStatus("unsubscribed");
  }

  return { status, subscribe, unsubscribe };
}

export function usePushDevice() {
  const native = useNativePush();
  const web = useWebPush();
  return Capacitor.isNativePlatform() ? native : web;
}
