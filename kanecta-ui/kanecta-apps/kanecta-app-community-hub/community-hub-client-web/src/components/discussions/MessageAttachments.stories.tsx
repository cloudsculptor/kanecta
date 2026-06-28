import type { Meta, StoryObj } from "@storybook/react-vite";
import MessageAttachments from "./MessageAttachments";
import type { MessageFile } from "../../api/discussions";

const PLACEHOLDER_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==";

const imgVisible: MessageFile = {
  id: "mf1", file_id: "f1", name: "market-stalls.jpg", mime_type: "image/jpeg",
  size_bytes: 184_320, url: PLACEHOLDER_IMAGE, show_preview: true,
};

const imgHidden: MessageFile = {
  id: "mf2", file_id: "f2", name: "event-photo.jpg", mime_type: "image/jpeg",
  size_bytes: 98_560, url: PLACEHOLDER_IMAGE, show_preview: false,
};

const pdfFile: MessageFile = {
  id: "mf3", file_id: "f3", name: "weekend-agenda.pdf", mime_type: "application/pdf",
  size_bytes: 82_500, url: "#", show_preview: true,
};

const wordFile: MessageFile = {
  id: "mf4", file_id: "f4",
  name: "minutes-featherston-resilience-working-group-2025-03.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size_bytes: 24_120, url: "#", show_preview: true,
};

const smallFile: MessageFile = {
  id: "mf5", file_id: "f5", name: "note.txt", mime_type: "text/plain",
  size_bytes: 420, url: "#", show_preview: true,
};

const largeFile: MessageFile = {
  id: "mf6", file_id: "f6", name: "recording.mp4", mime_type: "video/mp4",
  size_bytes: 9_437_184, url: "#", show_preview: true,
};

const meta: Meta<typeof MessageAttachments> = {
  title: "Discussions/MessageAttachments",
  component: MessageAttachments,
  decorators: [
    (Story) => (
      <div style={{ padding: 20, maxWidth: 600, border: "1px solid #e5e4e7", borderRadius: 8 }}>
        <Story />
      </div>
    ),
  ],
  args: { canDelete: false },
};
export default meta;
type Story = StoryObj<typeof MessageAttachments>;

/** Image with preview visible — hover reveals the hide and delete controls. */
export const SingleImageVisible: Story = {
  args: { files: [imgVisible] },
};

/** Image with preview collapsed — shows the chip with a "Show image" toggle. */
export const SingleImageHidden: Story = {
  args: { files: [imgHidden] },
};

/** Non-image file — PDF chip with file icon and size. */
export const SinglePdf: Story = {
  args: { files: [pdfFile] },
};

/** Very long filename — chip should truncate with ellipsis rather than overflowing. */
export const LongFilename: Story = {
  args: { files: [wordFile] },
};

/** File owner — delete button appears on each attachment. */
export const WithDeleteButtons: Story = {
  args: { files: [imgVisible, pdfFile], canDelete: true },
};

/** Mix of image (shown), image (hidden), and a non-image file. */
export const MixedTypes: Story = {
  args: { files: [imgVisible, imgHidden, pdfFile] },
};

/** Four files — verifies layout at higher attachment counts. */
export const MultipleFiles: Story = {
  args: { files: [imgVisible, pdfFile, wordFile, smallFile], canDelete: true },
};

/** Small text file — verifies byte and KB formatting thresholds. */
export const SmallFile: Story = {
  args: { files: [smallFile] },
};

/** Large video file — verifies MB size formatting. */
export const LargeFile: Story = {
  args: { files: [largeFile] },
};
