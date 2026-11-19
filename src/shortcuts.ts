import { coreCommands } from "./commands";

export type ShortcutCommand = { id: string; name: string; shortcut?: string };
const reserved = new Set([
  "Ctrl+C",
  "Ctrl+X",
  "Ctrl+V",
  "Ctrl+Insert",
  "Shift+Insert",
  "Shift+Delete",
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
  "Alt+F4",
]);
export function normalizeShortcut(value: string): string {
  if (!value.trim()) return "";
  const parts = value
    .trim()
    .split("+")
    .map((part) => part.trim());
  const key = parts.pop() ?? "";
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  if (
    modifiers.size !== parts.length ||
    parts.some((part) => !/^(ctrl|alt|shift)$/i.test(part))
  )
    throw new Error("快捷键修饰键应为 Ctrl、Alt 或 Shift");
  const names: Record<string, string> = {
    arrowleft: "Left",
    arrowright: "Right",
    arrowup: "Up",
    arrowdown: "Down",
    left: "Left",
    right: "Right",
    up: "Up",
    down: "Down",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    tab: "Tab",
    space: "Space",
    backspace: "Backspace",
    plus: "Plus",
    "/": "Slash", "[": "BracketLeft", "]": "BracketRight", "=": "Equal",
    slash: "Slash", bracketleft: "BracketLeft", bracketright: "BracketRight", equal: "Equal",
  };
  const normalized = names[key.toLowerCase()] ?? key.toUpperCase();
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Left|Right|Up|Down|Delete|Insert|Home|End|PageUp|PageDown|Tab|Space|Backspace|Plus|Slash|BracketLeft|BracketRight|Equal|[,.\-])$/.test(
      normalized,
    )
  )
    throw new Error("不支持此快捷键，请使用字母、数字、功能键或方向键");
  if (
    !modifiers.has("ctrl") &&
    !modifiers.has("alt") &&
    !/^F\d+$/.test(normalized) &&
    normalized !== "Delete"
  )
    throw new Error("请使用 Ctrl 或 Alt 组合键，避免影响输入文字");
  return [
    ...["ctrl", "alt", "shift"]
      .filter((part) => modifiers.has(part))
      .map((part) => part[0].toUpperCase() + part.slice(1)),
    normalized,
  ].join("+");
}
export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): string {
  if (
    [
      "Control",
      "Shift",
      "Alt",
      "Meta",
      "Escape",
      "Enter",
      "Dead",
      "Process",
    ].includes(event.key)
  )
    return "";
  const key =
    event.key === " " ? "Space" : event.key === "+" ? "Plus" : event.key;
  try {
    return normalizeShortcut(
      [
        event.ctrlKey || event.metaKey ? "Ctrl" : "",
        event.altKey ? "Alt" : "",
        event.shiftKey ? "Shift" : "",
        key,
      ]
        .filter(Boolean)
        .join("+"),
    );
  } catch {
    return "";
  }
}
export function effectiveShortcut(
  command: ShortcutCommand,
  overrides: Record<string, string>,
): string {
  return overrides[command.id] ?? command.shortcut ?? "";
}
export function validateShortcuts(
  overrides: Record<string, string>,
  extra: ShortcutCommand[] = [],
): string {
  const commands: ShortcutCommand[] = coreCommands.map(
    ([id, name, shortcut]) => ({ id, name, shortcut }),
  );
  commands.push(
    ...extra.filter(
      (item) => !commands.some((command) => command.id === item.id),
    ),
  );
  // Also validate saved bindings whose plugin is currently disabled.
  commands.push(
    ...Object.keys(overrides)
      .filter((id) => !commands.some((command) => command.id === id))
      .map((id) => ({ id, name: id })),
  );
  const used = new Map<string, string>();
  for (const command of commands) {
    const raw = effectiveShortcut(command, overrides);
    if (!raw) continue;
    let shortcut: string;
    try {
      shortcut = normalizeShortcut(raw);
    } catch (error) {
      return `${command.name}：${(error as Error).message}`;
    }
    if (reserved.has(shortcut))
      return `${shortcut} 已用于系统操作或工作目录切换`;
    const other = used.get(shortcut);
    if (other) return `${shortcut} 同时分配给“${other}”和“${command.name}”`;
    used.set(shortcut, command.name);
  }
  return "";
}
