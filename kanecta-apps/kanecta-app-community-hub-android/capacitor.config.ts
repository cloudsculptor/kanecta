import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "nz.co.featherston",
  appName: "Featherston",
  webDir: "www",
  server: {
    url: "https://featherston.co.nz",
    cleartext: false,
  },
  plugins: {
    StatusBar: {
      style: "dark",
      backgroundColor: "#0d2b12",
    },
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0d2b12",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
  },
  android: {
    minSdkVersion: 23,
  },
};

export default config;
