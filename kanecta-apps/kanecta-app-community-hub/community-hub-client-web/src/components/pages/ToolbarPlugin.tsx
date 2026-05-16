import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  $createParagraphNode,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from "lexical";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $isHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, $isListNode } from "@lexical/list";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import { INSERT_IMAGE_COMMAND } from "./ImageNode";
import { uploadPageFile } from "../../api/pages";

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "ul" | "ol";

function Divider() {
  return <div className="lex-toolbar__divider" aria-hidden />;
}

interface ToolbarBtnProps {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function Btn({ active, disabled, title, onClick, children }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      className={`lex-toolbar__btn${active ? " lex-toolbar__btn--active" : ""}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface Props {
  onUploadError?: (msg: string) => void;
}

export default function ToolbarPlugin({ onUploadError }: Props) {
  const [editor] = useLexicalComposerContext();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [isLink, setIsLink] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    setIsBold(selection.hasFormat("bold"));
    setIsItalic(selection.hasFormat("italic"));
    setIsUnderline(selection.hasFormat("underline"));

    const anchorNode = selection.anchor.getNode();
    const parent = anchorNode.getParent();
    setIsLink($isLinkNode(parent) || $isLinkNode(anchorNode));

    const element = anchorNode.getKey() === "root"
      ? anchorNode
      : anchorNode.getTopLevelElementOrThrow();

    if ($isHeadingNode(element)) {
      setBlockType(element.getTag() as BlockType);
    } else if ($isListNode(element)) {
      const parent = $getNearestNodeOfType(anchorNode, element.constructor as never);
      const listNode = parent ?? element;
      setBlockType(($isListNode(listNode) ? listNode.getListType() === "bullet" ? "ul" : "ol" : "paragraph") as BlockType);
    } else {
      setBlockType("paragraph");
    }
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(updateToolbar);
      }),
      editor.registerCommand(CAN_UNDO_COMMAND, (v) => { setCanUndo(v); return false; }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(CAN_REDO_COMMAND, (v) => { setCanRedo(v); return false; }, COMMAND_PRIORITY_CRITICAL),
    );
  }, [editor, updateToolbar]);

  function setBlock(tag: HeadingTagType | "paragraph") {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (tag === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createHeadingNode(tag));
        }
      }
    });
  }

  function insertList(type: "ul" | "ol") {
    editor.dispatchCommand(
      type === "ul" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
      undefined
    );
  }

  function insertLink() {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      const url = prompt("Enter URL:");
      if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, { url });
    }
  }

  async function handleImageFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadPageFile(fd);
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, { src: result.url, altText: file.name });
    } catch (err) {
      onUploadError?.((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="lex-toolbar" role="toolbar" aria-label="Text formatting">
      <Btn title="Undo" disabled={!canUndo} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>↩</Btn>
      <Btn title="Redo" disabled={!canRedo} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>↪</Btn>
      <Divider />
      <Btn title="Bold" active={isBold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}><b>B</b></Btn>
      <Btn title="Italic" active={isItalic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}><i>I</i></Btn>
      <Btn title="Underline" active={isUnderline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}><u>U</u></Btn>
      <Divider />
      <Btn title="Heading 1" active={blockType === "h1"} onClick={() => setBlock("h1")}>H1</Btn>
      <Btn title="Heading 2" active={blockType === "h2"} onClick={() => setBlock("h2")}>H2</Btn>
      <Btn title="Heading 3" active={blockType === "h3"} onClick={() => setBlock("h3")}>H3</Btn>
      <Btn title="Paragraph" active={blockType === "paragraph"} onClick={() => setBlock("paragraph")}>¶</Btn>
      <Divider />
      <Btn title="Bullet list" active={blockType === "ul"} onClick={() => insertList("ul")}>• List</Btn>
      <Btn title="Numbered list" active={blockType === "ol"} onClick={() => insertList("ol")}>1. List</Btn>
      <Divider />
      <Btn title="Link" active={isLink} onClick={insertLink}>Link</Btn>
      <Divider />
      <Btn title="Insert image" disabled={uploading} onClick={() => imageInputRef.current?.click()}>
        {uploading ? "Uploading…" : "Image"}
      </Btn>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
