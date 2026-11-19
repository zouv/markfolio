import { useEffect, useRef } from "react";
import * as codeMirrorState from "@codemirror/state";
import * as codeMirrorView from "@codemirror/view";
import { basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  undo,
  redo,
  indentMore,
  indentLess,
  insertNewlineAndIndent,
  moveLineUp, moveLineDown, copyLineUp, copyLineDown, deleteLine, toggleComment,
  selectAll, selectLine, indentSelection,
} from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { useApp, type Buffer } from "./store";
import type { Settings } from "./types";
import { parentPath, relativeLink, displayError } from "./types";
import { fileAsBase64, htmlToMarkdown } from "./conversion";
import { writeAsset } from "./api";
import { sortSelectedLines } from "./metadata";
import { vim } from "@replit/codemirror-vim";
import { emacs } from "@replit/codemirror-emacs";

const states = new Map<string, EditorState>();
export const codeMirror = { state: codeMirrorState, view: codeMirrorView };
const views = new Map<string, EditorView>();
const pluginExtensions = new Map<string, Map<string, Extension>>();
const configuration = new Compartment();
const extensionConfiguration = new Compartment();
type RichActions = { select():string; insert(text:string,before:string,after:string,replace:boolean):void; focus():void };
const richEditors = new Map<string,RichActions>();
export function registerRichEditor(workspace:string,path:string,actions:RichActions) { const id=key(workspace,path);richEditors.set(id,actions);return ()=>{richEditors.delete(id);}; }
const bookmarkEffect = codeMirrorState.StateEffect.define<{ id: string; from?: number; to?: number }>();
const bookmarks = codeMirrorState.StateField.define<Map<string, { from: number; to: number }>>({
  create: () => new Map(),
  update(value, transaction) {
    const next = new Map([...value].map(([id, range]) => [id, { from: transaction.changes.mapPos(range.from), to: transaction.changes.mapPos(range.to, 1) }]));
    for (const effect of transaction.effects) if (effect.is(bookmarkEffect)) {
      if (effect.value.from === undefined) next.delete(effect.value.id);
      else next.set(effect.value.id, { from: effect.value.from, to: effect.value.to ?? effect.value.from });
    }
    return next;
  },
});
function key(workspace: string, path: string) {
  return `${workspace}:${path}`;
}
function theme(settings: Settings): Extension {
  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: `${settings.fontSize}px`,
          color: "var(--text)",
          backgroundColor: "var(--editor)",
        },
        ".cm-scroller": {
          fontFamily: settings.fontFamily,
          lineHeight: String(settings.lineHeight),
          overflow: "auto",
        },
        ".cm-content": { padding: "24px 18px 80px", minHeight: "100%" },
        ".cm-gutters": {
          background: "var(--editor)",
          color: "var(--muted)",
          border: "none",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "38px",
          padding: "0 8px",
        },
        ".cm-activeLine": { background: "var(--active-line)" },
        ".cm-activeLineGutter": { background: "transparent" },
        ".cm-cursor": { borderLeftColor: "var(--text)" },
        ".cm-selectionBackground": {
          background: "var(--selection) !important",
        },
        ".cm-panels": { background: "var(--surface)", color: "var(--text)" },
        ".cm-lineNumbers": { display: settings.lineNumbers ? "flex" : "none" },
      },
      { dark: settings.theme === "dark" },
    ),
    settings.wordWrap ? EditorView.lineWrapping : [],
    settings.lineNumbers ? lineNumbers() : [],
    EditorView.contentAttributes.of({ spellcheck: String(settings.spellcheck), lang: settings.locale }),
    settings.keyMode === "vim" ? vim() : settings.keyMode === "emacs" ? emacs() : [],
  ];
}
function extensionsFor(workspace: string): Extension[] {
  return [...(pluginExtensions.get(workspace)?.values() ?? [])];
}
function createEditorState(
  workspace: string,
  buffer: Buffer,
  settings: Settings,
): EditorState {
  const id = key(workspace, buffer.path);
  return EditorState.create({
    doc: buffer.text,
    extensions: [
      basicSetup,
      bookmarks,
      markdown({ codeLanguages: languages }),
      configuration.of(theme(settings)),
      extensionConfiguration.of(extensionsFor(workspace)),
      keymap.of([
        { key: "Tab", run: indentMore },
        { key: "Shift-Tab", run: indentLess },
        { key: "Enter", run: insertNewlineAndIndent },
      ]),
      EditorView.domEventHandlers({
        paste(event, view) {
          if (view.state.readOnly) return false;
          const items = [...(event.clipboardData?.items ?? [])];
          const images = items.filter(item => item.kind === "file" && item.type.startsWith("image/"));
          if (images.length) {
            event.preventDefault();
            const token = crypto.randomUUID();
            view.dispatch({ effects: bookmarkEffect.of({ id: token, from: view.state.selection.main.from, to: view.state.selection.main.to }) });
            void (async () => {
              const references: string[] = [];
              for (const item of images) {
                const file = item.getAsFile(); if (!file) continue;
                const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
                const path = await writeAsset(workspace, parentPath(buffer.path), `paste-${Date.now()}-${crypto.randomUUID().slice(0,8)}.${ext}`, await fileAsBase64(file));
                references.push(`![图片](${relativeLink(buffer.path, path)})`);
              }
              const cached = views.get(id)?.state ?? states.get(id);
              const range = cached?.field(bookmarks).get(token);
              if (range && useApp.getState().sessions[workspace]?.documents[buffer.path]) editorActions.change(workspace, buffer.path, range.from, range.to, references.join("\n"));
              await useApp.getState().refresh(workspace);
            })().catch(error => useApp.getState().setNotice(displayError(error)));
            return true;
          }
          const html = event.clipboardData?.getData("text/html");
          if (html && useApp.getState().settings.htmlPaste) {
            event.preventDefault();
            view.dispatch(view.state.replaceSelection(htmlToMarkdown(html)));
            return true;
          }
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        states.set(id, update.state);
        if (update.docChanged)
          useApp
            .getState()
            .edit(workspace, buffer.path, update.state.doc.toString());
      }),
    ],
  });
}
function historyAction(workspace: string, action: typeof undo) {
  const session = useApp.getState().sessions[workspace];
  if (!session?.file) return;
  const id = key(workspace, session.file);
  const view = views.get(id);
  if (view) {
    action(view);
    return;
  }
  const state = states.get(id);
  if (!state) return;
  action({
    state,
    dispatch(transaction) {
      states.set(id, transaction.state);
      useApp
        .getState()
        .edit(workspace, session.file, transaction.state.doc.toString());
    },
  });
}

export const editorActions = {
  change(workspace: string, path: string, from: number, to: number, insert: string) {
    const current = useApp.getState(); const session = current.sessions[workspace];
    const buffer = session?.documents[path]; if (!buffer || session.mutating) return;
    const id = key(workspace, path); const view = views.get(id);
    let state = view?.state ?? states.get(id);
    if (!state || state.doc.toString() !== buffer.text) state = createEditorState(workspace, buffer, current.settings);
    from = Math.min(from, state.doc.length); to = Math.min(to, state.doc.length);
    const transaction = state.update({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" });
    if (view) view.dispatch(transaction);
    else { states.set(id, transaction.state); current.edit(workspace, path, transaction.state.doc.toString()); }
  },
  replaceDocument(workspace: string, path: string, text: string) {
    const buffer = useApp.getState().sessions[workspace]?.documents[path];
    if (buffer) this.change(workspace, path, 0, buffer.text.length, text);
  },
  command(workspace: string, name: string) {
    const session = useApp.getState().sessions[workspace];
    const view = session && views.get(key(workspace, session.file));
    if (!view || view.state.readOnly) return;
    const actions: Record<string, (view: EditorView) => boolean> = { moveLineUp, moveLineDown, copyLineUp, copyLineDown, deleteLine, toggleComment, selectAll, selectLine, indentSelection, indentMore, indentLess };
    if (name === "sortLines" || name === "sortLinesReverse") view.dispatch({ changes: sortSelectedLines(view.state.doc.toString(), view.state.selection.main.from, view.state.selection.main.to, name === "sortLinesReverse") });
    else actions[name]?.(view);
    view.focus();
  },
  insert(
    workspace: string,
    text: string,
    before = "",
    after = "",
    replace = false,
  ) {
    const session = useApp.getState().sessions[workspace];
    if (!session?.file) return;
    if (session.mutating) return;
    const id = key(workspace, session.file);
    const rich = richEditors.get(id);
    if (rich) { rich.insert(text,before,after,replace); return; }
    const view = views.get(id);
    let state = view?.state ?? states.get(id);
    if (!state) {
      const buffer = session.documents[session.file];
      if (!buffer) return;
      state = createEditorState(workspace, buffer, useApp.getState().settings);
    }
    const selected = state.sliceDoc(
      state.selection.main.from,
      state.selection.main.to,
    );
    const insert =
      before +
      (replace || (!before && !after) ? text : selected || text) +
      after;
    const transaction = state.update({
      changes: {
        from: state.selection.main.from,
        to: state.selection.main.to,
        insert,
      },
      selection: { anchor: state.selection.main.from + insert.length },
      userEvent: "input",
    });
    if (view) {
      view.dispatch(transaction);
      view.focus();
    } else {
      states.set(id, transaction.state);
      useApp
        .getState()
        .edit(workspace, session.file, transaction.state.doc.toString());
    }
  },
  undo(workspace: string) {
    historyAction(workspace, undo);
  },
  redo(workspace: string) {
    historyAction(workspace, redo);
  },
  find(workspace: string) {
    const session = useApp.getState().sessions[workspace];
    const view = session && views.get(key(workspace, session.file));
    if (view) openSearchPanel(view);
  },
  select(workspace: string): string {
    const session = useApp.getState().sessions[workspace];
    const rich = session && richEditors.get(key(workspace,session.file)); if(rich)return rich.select();
    const state =
      session &&
      (views.get(key(workspace, session.file))?.state ??
        states.get(key(workspace, session.file)));
    return (
      state?.sliceDoc(state.selection.main.from, state.selection.main.to) ?? ""
    );
  },
  focus(workspace: string) {
    const session = useApp.getState().sessions[workspace];
    const rich = session && richEditors.get(key(workspace,session.file)); if(rich){rich.focus();return;}
    if (session) views.get(key(workspace, session.file))?.focus();
  },
  addExtension(workspace: string, pluginId: string, extension: Extension) {
    const registered = pluginExtensions.get(workspace) ?? new Map();
    registered.set(pluginId, extension);
    pluginExtensions.set(workspace, registered);
    for (const [id, view] of views)
      if (id.startsWith(`${workspace}:`))
        view.dispatch({
          effects: extensionConfiguration.reconfigure(extensionsFor(workspace)),
        });
    return () => {
      registered.delete(pluginId);
      for (const [id, view] of views)
        if (id.startsWith(`${workspace}:`))
          view.dispatch({
            effects: extensionConfiguration.reconfigure(
              extensionsFor(workspace),
            ),
          });
    };
  },
  clear(workspace: string) {
    for (const id of states.keys())
      if (id.startsWith(`${workspace}:`)) states.delete(id);
    pluginExtensions.delete(workspace);
  },
  prune(workspace: string) {
    const documents = useApp.getState().sessions[workspace]?.documents ?? {};
    for (const id of states.keys()) if (id.startsWith(`${workspace}:`) && !(id.slice(workspace.length + 1) in documents) && !views.has(id)) states.delete(id);
  },
};

export default function Editor({
  workspace,
  buffer,
  settings,
  readOnly = false,
}: {
  workspace: string;
  buffer: Buffer;
  settings: Settings;
  readOnly?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  useEffect(() => {
    if (!container.current) return;
    const id = key(workspace, buffer.path);
    let state = states.get(id);
    if (!state || state.doc.toString() !== buffer.text)
      state = createEditorState(workspace, buffer, settings);
    const view = new EditorView({ state, parent: container.current });
    views.set(id, view);
    viewRef.current = view;
    view.dispatch({
      effects: extensionConfiguration.reconfigure(extensionsFor(workspace)),
    });
    return () => {
      states.set(id, view.state);
      views.delete(id);
      view.destroy();
      viewRef.current = undefined;
      editorActions.prune(workspace);
    };
    // Buffer content is synchronized separately; recreating on each keystroke destroys undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, buffer.path]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: configuration.reconfigure([
        theme(settings),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [settings, readOnly]);
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== buffer.text)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: buffer.text },
      });
  }, [buffer.text]);
  return (
    <div className="editor-host" ref={container} aria-label="Markdown 编辑器" />
  );
}
