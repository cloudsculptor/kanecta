import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect, fn } from "storybook/test";
import AttachmentBar, { type PendingFile } from "./AttachmentBar";

const meta: Meta<typeof AttachmentBar> = {
  title: "Discussions/AttachmentBar",
  component: AttachmentBar,
  decorators: [(Story) => <div style={{ padding: 20, maxWidth: 600, border: "1px solid #e5e4e7", borderRadius: 8 }}><Story /></div>],
  // onRemove is a fn() spy so behaviour stories can assert it fires with the
  // removed file's tempId. Storybook resets it before each story's play.
  args: { onRemove: fn() },
};
export default meta;
type Story = StoryObj<typeof AttachmentBar>;

const PLACEHOLDER_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTUwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzNhN2Q0NCIvPjwvc3ZnPg==";

const uploading: PendingFile = {
  tempId: "t1", name: "photo.jpg", mime_type: "image/jpeg", uploading: true,
};

const readyImage: PendingFile = {
  tempId: "t2", fileId: "f2", name: "photo.jpg", mime_type: "image/jpeg",
  size_bytes: 142_000, url: PLACEHOLDER_IMAGE, uploading: false,
};

const readyPdf: PendingFile = {
  tempId: "t3", fileId: "f3", name: "agenda.pdf", mime_type: "application/pdf",
  size_bytes: 82_500, uploading: false,
};

const readyDoc: PendingFile = {
  tempId: "t4", fileId: "f4", name: "minutes-2024-11.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size_bytes: 24_120, uploading: false,
};

const errorFile: PendingFile = {
  tempId: "t5", name: "toolarge.mp4", mime_type: "video/mp4", uploading: false,
  error: "Upload failed",
};

/** Single image that has finished uploading — shows a thumbnail. */
export const SingleImageReady: Story = {
  args: { files: [readyImage] },
};

/** Image still uploading — shows spinner text and no thumbnail yet. */
export const SingleImageUploading: Story = {
  args: { files: [uploading] },
};

/** Non-image file (PDF) — shows file icon instead of a thumbnail. */
export const SingleFile: Story = {
  args: { files: [readyPdf] },
};

/** Multiple files of different types — image + PDF + Word doc. */
export const MultipleFiles: Story = {
  args: { files: [readyImage, readyPdf, readyDoc] },
};

/** Mix of uploading, ready, and errored files at the same time. */
export const MixedStates: Story = {
  args: { files: [uploading, readyImage, readyPdf, errorFile] },
};

/** Upload failed — shows red error text and still has the remove button. */
export const UploadError: Story = {
  args: { files: [errorFile] },
};

/** Six files — verifies the bar wraps correctly and doesn't overflow. */
export const ManyFiles: Story = {
  args: {
    files: [
      readyImage,
      readyPdf,
      readyDoc,
      { ...readyImage, tempId: "t6", name: "event-photo.png" },
      { ...readyPdf, tempId: "t7", name: "budget-2025.pdf" },
      { ...uploading, tempId: "t8", name: "video.mp4", mime_type: "video/mp4" },
    ],
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Pin: file names render, per-file remove button fires onRemove with the right
// tempId, and the uploading / error status labels render. Text matches the
// component's exact strings (note "Uploading…" uses a real ellipsis char).

/** Each pending file renders its name. */
export const RendersFileNames: Story = {
  args: { files: [readyImage, readyPdf, readyDoc] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("photo.jpg")).toBeInTheDocument();
    await expect(canvas.getByText("agenda.pdf")).toBeInTheDocument();
    await expect(canvas.getByText("minutes-2024-11.docx")).toBeInTheDocument();
  },
};

/** Clicking a file's remove button calls onRemove with that file's tempId. */
export const RemoveFiresCallback: Story = {
  args: { files: [readyPdf] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle("Remove"));
    await expect(args.onRemove).toHaveBeenCalledWith("t3");
  },
};

/** With several files, each row has its own remove button targeting its tempId. */
export const RemovePerFile: Story = {
  args: { files: [readyImage, readyPdf, readyDoc] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const removeButtons = canvas.getAllByRole("button", { name: "Remove attachment" });
    await expect(removeButtons).toHaveLength(3);
    await userEvent.click(removeButtons[1]);
    await expect(args.onRemove).toHaveBeenCalledWith("t3");
  },
};

/** An uploading file shows the "Uploading…" status label. */
export const ShowsUploadingStatus: Story = {
  args: { files: [uploading] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Uploading…")).toBeInTheDocument();
  },
};

/** An errored file shows its error message and still offers a remove button. */
export const ShowsErrorAndRemovable: Story = {
  args: { files: [errorFile] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Upload failed")).toBeInTheDocument();
    await userEvent.click(canvas.getByTitle("Remove"));
    await expect(args.onRemove).toHaveBeenCalledWith("t5");
  },
};
