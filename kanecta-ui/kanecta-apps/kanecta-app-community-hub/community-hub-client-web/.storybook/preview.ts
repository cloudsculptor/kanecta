import type { Preview } from "@storybook/react-vite";
import { initialize, mswLoader } from "msw-storybook-addon";
import "../src/index.scss";
import "../src/App.scss";

// Start Mock Service Worker so stories with `parameters.msw.handlers` receive
// mocked API responses (in Storybook and in the vitest browser test run).
// `onUnhandledRequest: "bypass"` lets any un-mocked request through untouched.
initialize({ onUnhandledRequest: "bypass" });

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: "todo" },
  },
};

export default preview;
