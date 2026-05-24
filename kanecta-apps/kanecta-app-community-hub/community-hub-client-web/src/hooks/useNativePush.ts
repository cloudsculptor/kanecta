import { useState, useEffect } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { pushApi } from "../api/push";
import type { PushDeviceStatus } from "./usePushDevice";

const FCM_TOKEN_KEY = "fcm_token";

export function useNativePush(): { status: PushDeviceStatus; subscribe: () => Promise<void>; unsubscribe: () => Promise<void> } {
  const [status, setStatus] = useState<PushDeviceStatus>("unsubscribed");

  useEffect(() => {
    PushNotifications.checkPermissions().then((result) => {
      if (result.receive === "denied") {
        setStatus("denied");
      } else if (localStorage.getItem(FCM_TOKEN_KEY)) {
        setStatus("subscribed");
      }
    });
  }, []);

  async function subscribe() {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") {
      setStatus("denied");
      return;
    }
    await PushNotifications.addListener("registration", async (token) => {
      try {
        await pushApi.saveFcmToken(token.value);
        localStorage.setItem(FCM_TOKEN_KEY, token.value);
        setStatus("subscribed");
      } catch {
        setStatus("unsubscribed");
      }
    });
    await PushNotifications.addListener("registrationError", () => {
      setStatus("unsubscribed");
    });
    await PushNotifications.register();
  }

  async function unsubscribe() {
    const token = localStorage.getItem(FCM_TOKEN_KEY);
    if (token) {
      try { await pushApi.removeFcmToken(token); } catch { /* ignore */ }
      localStorage.removeItem(FCM_TOKEN_KEY);
    }
    setStatus("unsubscribed");
  }

  return { status, subscribe, unsubscribe };
}
