import * as React from "react";
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  $applyNodeReplacement,
  createCommand,
  type LexicalCommand,
} from "lexical";

export type SerializedImageNode = Spread<
  { src: string; altText: string; type: "image"; version: 1 },
  SerializedLexicalNode
>;

export const INSERT_IMAGE_COMMAND: LexicalCommand<{ src: string; altText: string }> =
  createCommand("INSERT_IMAGE_COMMAND");

export class ImageNode extends DecoratorNode<React.JSX.Element> {
  __src: string;
  __altText: string;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__key);
  }

  static importJSON(s: SerializedImageNode): ImageNode {
    return $createImageNode({ src: s.src, altText: s.altText });
  }

  constructor(src: string, altText: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      src: this.__src,
      altText: this.__altText,
      type: "image",
      version: 1,
    };
  }

  isInline(): boolean {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "lex-image-wrapper";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(_editor: LexicalEditor): React.JSX.Element {
    return <img src={this.__src} alt={this.__altText} className="lex-image" />;
  }
}

export function $createImageNode({ src, altText }: { src: string; altText: string }): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, altText));
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
