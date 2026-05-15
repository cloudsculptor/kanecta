import { useCallback, useRef } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import MentionExtension from '@tiptap/extension-mention';
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../../store/workspace';
import { useQuery } from '@tanstack/react-query';
import type { KanectaItem } from '../../types/kanecta';
import { SlashMenu, SLASH_ITEMS, type SlashMenuHandle, type SlashMenuItem } from './SlashMenu';
import { MentionDropdown, type MentionDropdownHandle } from './MentionDropdown';
import './BlockEditor.scss';

interface BlockEditorProps {
  itemId: string;
  initialContent: string;
}

function buildSlashExtension() {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          render() {
            let component: ReactRenderer<SlashMenuHandle>;
            let popup: TippyInstance[];

            return {
              onStart(props) {
                const filtered = SLASH_ITEMS.filter((item) =>
                  item.label.toLowerCase().includes((props.query ?? '').toLowerCase()),
                );
                component = new ReactRenderer(SlashMenu, {
                  props: {
                    items: filtered,
                    command(item: SlashMenuItem) {
                      props.command({ id: item.type, label: item.label });
                    },
                  },
                  editor: props.editor,
                });
                if (!props.clientRect) return;
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },
              onUpdate(props) {
                const filtered = SLASH_ITEMS.filter((item) =>
                  item.label.toLowerCase().includes((props.query ?? '').toLowerCase()),
                );
                component.updateProps({
                  items: filtered,
                  command(item: SlashMenuItem) {
                    props.command({ id: item.type, label: item.label });
                  },
                });
                if (!props.clientRect) return;
                popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
              },
              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  popup[0].hide();
                  return true;
                }
                return component.ref?.onKeyDown(props.event) ?? false;
              },
              onExit() {
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },
          command({ editor, range, props }) {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent(`[${props.label}] `)
              .run();
          },
        }),
      ];
    },
  });
}

function buildMentionExtension(allItems: KanectaItem[]) {
  return MentionExtension.configure({
    HTMLAttributes: { class: 'BlockEditor-mention' },
    suggestion: {
      char: '@',
      items({ query }) {
        const q = query.toLowerCase();
        return allItems.filter((item) => item.value.toLowerCase().includes(q)).slice(0, 10);
      },
      render() {
        let component: ReactRenderer<MentionDropdownHandle>;
        let popup: TippyInstance[];

        return {
          onStart(props) {
            component = new ReactRenderer(MentionDropdown, {
              props: {
                items: props.items,
                command(item: KanectaItem) {
                  props.command({ id: item.id, label: item.value });
                },
              },
              editor: props.editor,
            });
            if (!props.clientRect) return;
            popup = tippy('body', {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            });
          },
          onUpdate(props) {
            component.updateProps({
              items: props.items,
              command(item: KanectaItem) {
                props.command({ id: item.id, label: item.value });
              },
            });
            if (!props.clientRect) return;
            popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
          },
          onKeyDown(props) {
            if (props.event.key === 'Escape') {
              popup[0].hide();
              return true;
            }
            return component.ref?.onKeyDown(props.event) ?? false;
          },
          onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
      command({ editor, range, props }) {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(`[[${props.id}]]`)
          .run();
      },
    },
  });
}

export function BlockEditor({ itemId, initialContent }: BlockEditorProps) {
  const { getApi } = useWorkspaceStore();
  const qc = useQueryClient();
  const savedRef = useRef(initialContent);

  const { data: allItems = [] } = useQuery<KanectaItem[]>({
    queryKey: ['all-items-flat'],
    queryFn: async () => {
      const tree = await getApi().tree.full();
      function flatten(nodes: KanectaItem[]): KanectaItem[] {
        return nodes.flatMap((n) => [n, ...flatten((n as { children?: KanectaItem[] }).children ?? [])]);
      }
      return flatten(tree as KanectaItem[]);
    },
  });

  const mutation = useMutation({
    mutationFn: (content: string) =>
      getApi().items.update(itemId, { value: content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['item', itemId] });
    },
  });

  const handleBlur = useCallback(
    (content: string) => {
      if (content !== savedRef.current) {
        savedRef.current = content;
        mutation.mutate(content);
      }
    },
    [mutation],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing… (/ for commands, @ for mentions)' }),
      buildSlashExtension(),
      buildMentionExtension(allItems),
    ],
    content: initialContent,
    onBlur({ editor: e }) {
      handleBlur(e.getHTML());
    },
  });

  return (
    <div className="BlockEditor">
      <EditorContent editor={editor} className="BlockEditor-content" />
      {mutation.isPending && <span className="BlockEditor-saving">Saving…</span>}
    </div>
  );
}
