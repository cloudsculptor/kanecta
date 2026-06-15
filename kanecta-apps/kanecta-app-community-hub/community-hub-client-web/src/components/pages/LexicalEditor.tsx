import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import type { EditorState } from "lexical";
import { ImageNode } from "./ImageNode";
import ImagesPlugin from "./ImagesPlugin";
import ToolbarPlugin from "./ToolbarPlugin";

interface Props {
  initialState?: object | null;
  onChange?: (state: object) => void;
  editable?: boolean;
  onUploadError?: (msg: string) => void;
}

const EDITOR_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, ImageNode];

export default function LexicalEditor({ initialState, onChange, editable = true, onUploadError }: Props) {
  const initialConfig = {
    namespace: "PageEditor",
    nodes: EDITOR_NODES,
    editorState: initialState && "root" in initialState ? JSON.stringify(initialState) : null,
    editable,
    onError: (error: Error) => console.error("[Lexical]", error),
    theme: {
      heading: {
        h1: "lex-h1",
        h2: "lex-h2",
        h3: "lex-h3",
      },
      list: {
        ul: "lex-ul",
        ol: "lex-ol",
        listitem: "lex-li",
      },
      text: {
        bold: "lex-bold",
        italic: "lex-italic",
        underline: "lex-underline",
      },
      link: "lex-link",
      paragraph: "lex-paragraph",
    },
  };

  function handleChange(editorState: EditorState) {
    if (onChange) {
      onChange(editorState.toJSON());
    }
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={`lex-editor${editable ? " lex-editor--editable" : ""}`}>
        {editable && <ToolbarPlugin onUploadError={onUploadError} />}
        <div className="lex-editor__body">
          <RichTextPlugin
            contentEditable={<ContentEditable className="lex-content" />}
            placeholder={editable ? <div className="lex-placeholder">Start writing…</div> : null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <ImagesPlugin />
          <TabIndentationPlugin />
          {onChange && <OnChangePlugin onChange={handleChange} ignoreSelectionChange />}
        </div>
      </div>
    </LexicalComposer>
  );
}
