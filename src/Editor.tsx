import { t } from "./i18n";
import { useEffect, useRef } from "react";
import * as codeMirrorState from "@codemirror/state";
import * as codeMirrorView from "@codemirror/view";
import { basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import {
  undo,
  redo,
  indentMore,
  indentLess,
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
import { livePreview } from "./livePreview";
import { editTable,type TableAction } from "./tableEditing";

const states = new Map<string, EditorState>();
export const codeMirror = { state: codeMirrorState, view: codeMirrorView };
const views = new Map<string, EditorView>();
const pluginExtensions = new Map<string, Map<string, Extension>>();
const configuration = new Compartment();
const extensionConfiguration = new Compartment();
const liveConfiguration = new Compartment();
const bookmarkEffect = codeMirrorState.StateEffect.define<{ id: string; from?: number; to?: number }>();
const bookmarks = codeMirrorState.StateField.define<Map<string, { from: number; to: number }>>({
  create: () => new Map(),
  update(value, transaction) {
    const next = new Map([...value].map(([id, range]) => {const collapsed=range.from===range.to;return [id, { from: transaction.changes.mapPos(range.from,collapsed?1:-1), to: transaction.changes.mapPos(range.to, 1) }];}));
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
        ".cm-activeLine": { background: "transparent", boxShadow: "inset 2px 0 var(--border)" },
        ".cm-activeLineGutter": { background: "transparent", color: "var(--text)" },
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
    settings.tabMovesFocus ? [] : keymap.of([{ key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess }]),
    settings.keyMode === "vim" ? vim() : settings.keyMode === "emacs" ? emacs() : [],
  ];
}
function extensionsFor(workspace: string): Extension[] {
  return [...(pluginExtensions.get(workspace)?.values() ?? [])];
}
function liveOptions(workspace: string, path: string, settings: Settings, readOnly: boolean) {
  return {
    workspace,
    path,
    mode: settings.editorMode,
    math: settings.math,
    rawHtml: settings.rawHtml,
    extensions: settings.markdownExtensions,
    inlineWidgets: settings.inlineWidgets,
    readOnly,
  };
}
function createEditorState(
  workspace: string,
  buffer: Buffer,
  settings: Settings,
  readOnly = false,
): EditorState {
  const id = key(workspace, buffer.path);
  return EditorState.create({
    doc: buffer.text,
    extensions: [
      basicSetup,
      bookmarks,
      liveConfiguration.of(livePreview(liveOptions(workspace, buffer.path, settings, readOnly))),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      configuration.of(theme(settings)),
      extensionConfiguration.of(extensionsFor(workspace)),
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
                references.push(t("![图片]({0})", relativeLink(buffer.path, path)));
              }
              const cached = views.get(id)?.state ?? states.get(id);
              const range = cached?.field(bookmarks).get(token);
              if (range && useApp.getState().sessions[workspace]?.documents[buffer.path]) editorActions.change(workspace, buffer.path, range.from, range.to, references.join("\n"));
              await useApp.getState().refresh(workspace);
            })().catch(error => useApp.getState().setNotice(displayError(error))).finally(()=>editorActions.discardCapture({workspace,path:buffer.path,token}));
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

function currentState(workspace: string, path: string): EditorState | undefined {
  const view = views.get(key(workspace, path));
  const session = useApp.getState().sessions[workspace];
  const buffer = session?.documents[path];
  if (!buffer) return undefined;
  let state = view?.state ?? states.get(key(workspace, path));
  if (!state || state.doc.toString() !== buffer.text) state = createEditorState(workspace, buffer, useApp.getState().settings, session.mutating);
  return state;
}
function applyTransaction(workspace: string, path: string, transaction: codeMirrorState.Transaction) {
  const view = views.get(key(workspace, path));
  if (view) view.dispatch(transaction);
  else {
    states.set(key(workspace, path), transaction.state);
    useApp.getState().edit(workspace, path, transaction.state.doc.toString());
  }
}
function toggleInline(state: EditorState, marker: string, placeholder: string) {
  const { from, to } = state.selection.main;
  const doc = state.doc;
  const before = doc.sliceString(Math.max(0, from - marker.length), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + marker.length));
  const left = doc.sliceString(Math.max(0, from - 6), from);
  const right = doc.sliceString(to, Math.min(doc.length, to + 6));
  const leftRun = /(\*+)$/.exec(left)?.[1].length ?? 0;
  const rightRun = /^(\*+)/.exec(right)?.[1].length ?? 0;
  const wrapped =
    marker === "**"
      ? leftRun >= 2 && rightRun >= 2
      : marker === "*"
        ? leftRun % 2 === 1 && rightRun % 2 === 1
        : before === marker && after === marker;
  if (wrapped) {
    return {
      changes: [
        { from: from - marker.length, to: from, insert: "" },
        { from: to, to: to + marker.length, insert: "" },
      ],
      selection: { anchor: from - marker.length, head: to - marker.length },
    };
  }
  if (from === to) {
    const insert = marker + placeholder + marker;
    return {
      changes: { from, to, insert },
      selection: { anchor: from + marker.length, head: from + marker.length + placeholder.length },
    };
  }
  return {
    changes: [
      { from, to: from, insert: marker },
      { from: to, to, insert: marker },
    ],
    selection: { anchor: from + marker.length, head: to + marker.length },
  };
}
function linkNode(state: EditorState, from: number, to: number) {
  let node = syntaxTree(state).resolveInner(from, 1);
  while (node && node.name !== "Link") node = node.parent!;
  return node && node.from <= from && node.to >= to ? node : null;
}
function toggleLink(state: EditorState) {
  const { from, to } = state.selection.main;
  const node = linkNode(state, from, to);
  if (node) {
    const changes: { from: number; to: number; insert: string }[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling)
      if (["LinkMark", "URL", "LinkTitle"].includes(child.name)) changes.push({ from: child.from, to: child.to, insert: "" });
    if (!changes.length) return null;
    const changeSet = state.changes(changes);
    return { changes, selection: state.selection.map(changeSet, 1) };
  }
  const label = t("链接文本"), url = t("链接地址");
  if (from === to) {
    const insert = `[${label}](${url})`;
    return { changes: { from, to, insert }, selection: { anchor: from + 1, head: from + 1 + label.length } };
  }
  return {
    changes: [
      { from, to: from, insert: "[" },
      { from: to, to, insert: `](${url})` },
    ],
    selection: { anchor: from + 1, head: to + 1 },
  };
}
function toggleLinePrefix(state: EditorState, prefix: string, pattern: RegExp, alternates: RegExp[] = []) {
  const { from, to } = state.selection.main;
  const start = state.doc.lineAt(from).number;
  const end = state.doc.lineAt(to).number;
  const changes: { from: number; to?: number; insert: string }[] = [];
  for (let number = start; number <= end; number++) {
    const line = state.doc.line(number);
    const indent = /^[ \t]*/.exec(line.text)![0];
    const rest = line.text.slice(indent.length);
    const match = pattern.exec(rest);
    if (match) changes.push({ from: line.from + indent.length, to: line.from + indent.length + match[0].length, insert: "" });
    else {
      const alternate = alternates.map((alternatePattern) => alternatePattern.exec(rest)).find(Boolean);
      changes.push(
        alternate
          ? { from: line.from + indent.length, to: line.from + indent.length + alternate[0].length, insert: prefix }
          : { from: line.from + indent.length, insert: prefix },
      );
    }
  }
  const changeSet = state.changes(changes);
  return { changes, selection: state.selection.map(changeSet, 1) };
}
function codeNode(state: EditorState, from: number, to: number) {
  let node = syntaxTree(state).resolveInner(from, 1);
  while (node && !["FencedCode", "CodeBlock"].includes(node.name)) node = node.parent!;
  return node && node.from <= from && node.to >= to ? node : null;
}
function toggleCodeBlock(state: EditorState) {
  const { from, to } = state.selection.main;
  const doc = state.doc;
  const node = codeNode(state, from, to);
  if (node?.name === "FencedCode") {
    const openEnd = doc.lineAt(node.from).to;
    const closeStart = doc.lineAt(Math.max(node.from, node.to - 1)).from;
    const changes: { from: number; to: number; insert: string }[] = [{ from: closeStart, to: node.to, insert: "" }];
    if (openEnd < closeStart) changes.unshift({ from: node.from, to: openEnd + 1, insert: "" });
    const changeSet = state.changes(changes);
    return { changes, selection: state.selection.map(changeSet, 1) };
  }
  const start = doc.lineAt(from).from, end = doc.lineAt(to).to;
  if (from === to) {
    const before = from === 0 || doc.sliceString(from - 1, from) === "\n" ? "" : "\n";
    const after = from === doc.length || doc.sliceString(from, from + 1) === "\n" ? "" : "\n";
    const insert = `${before}\`\`\`\n${t("代码")}\n\`\`\`${after}`;
    return { changes: { from, to, insert }, selection: { anchor: from + before.length + 4, head: from + before.length + 4 + t("代码").length } };
  }
  const changes = [
    { from: start, to: start, insert: "```\n" },
    { from: end, to: end, insert: "\n```" },
  ];
  const changeSet = state.changes(changes);
  return { changes, selection: state.selection.map(changeSet, 1) };
}
function formatChange(state: EditorState, name: string) {
  switch (name) {
    case "bold": return toggleInline(state, "**", t("加粗文本"));
    case "italic": return toggleInline(state, "*", t("斜体文本"));
    case "code": return toggleInline(state, "`", t("代码"));
    case "heading": return toggleLinePrefix(state, "## ", /^#{1,6}\s+/);
    case "bullet": return toggleLinePrefix(state, "- ", /^(?![-+*]\s+\[[ xX]\]\s+)[-+*]\s+/, [/^[-+*]\s+\[[ xX]\]\s+/, /^\d+[.)]\s+/]);
    case "numbered": return toggleLinePrefix(state, "1. ", /^\d+[.)]\s+/, [/^[-+*]\s+\[[ xX]\]\s+/, /^[-+*]\s+/]);
    case "task": return toggleLinePrefix(state, "- [ ] ", /^[-+*]\s+\[[ xX]\]\s+/, [/^[-+*]\s+/, /^\d+[.)]\s+/]);
    case "quote": return toggleLinePrefix(state, "> ", /^>\s?/);
    case "link": return toggleLink(state);
    case "codeBlock": return toggleCodeBlock(state);
    case "rule": {
      const { from, to } = state.selection.main, insert = "\n---\n";
      return { changes: { from, to, insert }, selection: { anchor: from + insert.length, head: from + insert.length } };
    }
    case "table": {
      const { from, to } = state.selection.main, insert = "\n| A | B |\n| --- | --- |\n|  |  |\n";
      return { changes: { from, to, insert }, selection: { anchor: from + insert.length, head: from + insert.length } };
    }
    default: return null;
  }
}

export const editorActions = {
  capture(workspace:string) {
    const session=useApp.getState().sessions[workspace];
    if(!session?.file||!session.documents[session.file]||session.mutating)return undefined;
    const path=session.file,id=key(workspace,path);
    const state=currentState(workspace,path);
    if(!state)return undefined;
    const range=state.selection.main;
    const token=crypto.randomUUID();
    const transaction=state.update({effects:bookmarkEffect.of({id:token,from:range.from,to:range.to})});
    const view=views.get(id);if(view)view.dispatch(transaction);else states.set(id,transaction.state);
    return {workspace,path,token};
  },
  insertCaptured(target:{workspace:string;path:string;token:string},text:string) {
    const {workspace,path,token}=target,id=key(workspace,path);
    const state=views.get(id)?.state??states.get(id),range=state?.field(bookmarks).get(token);
    const session=useApp.getState().sessions[workspace];
    if(!range||!session?.documents[path]||session.mutating||state!.doc.toString()!==session.documents[path].text)return false;
    if(!this.change(workspace,path,range.from,range.to,text))return false;
    this.discardCapture(target);
    return true;
  },
  discardCapture(target:{workspace:string;path:string;token:string}) {
    const {workspace,path,token}=target,id=key(workspace,path);
    const view=views.get(id),current=view?.state??states.get(id);
    if(current){const transaction=current.update({effects:bookmarkEffect.of({id:token})});if(view)view.dispatch(transaction);else states.set(id,transaction.state);}
  },
  change(workspace: string, path: string, from: number, to: number, insert: string) {
    const current = useApp.getState(); const session = current.sessions[workspace];
    const buffer = session?.documents[path]; if (!buffer || session.mutating) return false;
    const id = key(workspace, path); const view = views.get(id);
    let state = view?.state ?? states.get(id);
    if (!state || state.doc.toString() !== buffer.text) state = createEditorState(workspace, buffer, current.settings);
    from = Math.min(from, state.doc.length); to = Math.min(to, state.doc.length);
    const transaction = state.update({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" });
    if (view) view.dispatch(transaction);
    else { states.set(id, transaction.state); current.edit(workspace, path, transaction.state.doc.toString()); }
    return true;
  },
  replaceDocument(workspace: string, path: string, text: string) {
    const buffer = useApp.getState().sessions[workspace]?.documents[path];
    if (!buffer || buffer.text===text) return;
    let from=0;while(from<buffer.text.length&&from<text.length&&buffer.text[from]===text[from])from++;
    let oldEnd=buffer.text.length,newEnd=text.length;while(oldEnd>from&&newEnd>from&&buffer.text[oldEnd-1]===text[newEnd-1]){oldEnd--;newEnd--;}
    this.change(workspace,path,from,oldEnd,text.slice(from,newEnd));
  },
  command(workspace: string, name: string) {
    const session = useApp.getState().sessions[workspace];
    const view = session && views.get(key(workspace, session.file));
    if (!view || view.state.readOnly) return;
    const actions: Record<string, (view: EditorView) => boolean> = { moveLineUp, moveLineDown, copyLineUp, copyLineDown, deleteLine, toggleComment, selectAll, selectLine, indentSelection, indentMore, indentLess };
    if(name.startsWith("table"))view.dispatch({changes:editTable(view.state.doc.toString(),view.state.selection.main.from,name as TableAction),userEvent:"input"});
    else if (name === "sortLines" || name === "sortLinesReverse") view.dispatch({ changes: sortSelectedLines(view.state.doc.toString(), view.state.selection.main.from, view.state.selection.main.to, name === "sortLinesReverse") });
    else actions[name]?.(view);
    view.focus();
  },
  format(workspace: string, name: string) {
    const session = useApp.getState().sessions[workspace];
    if (!session?.file || session.mutating || useApp.getState().settings.mode === "preview") return;
    const state = currentState(workspace, session.file);
    if (!state || state.readOnly) return;
    const result = formatChange(state, name);
    if (!result) return;
    applyTransaction(workspace, session.file, state.update({ ...result, userEvent: "input" }));
    views.get(key(workspace, session.file))?.focus();
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
      state = createEditorState(workspace, buffer, settings, readOnly);
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
      effects: [configuration.reconfigure([
        theme(settings),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]), liveConfiguration.reconfigure(livePreview(liveOptions(workspace, buffer.path, settings, readOnly)))],
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
    <div className="editor-host" ref={container} aria-label={t("Markdown 编辑器")} />
  );
}
