import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { t } from "../i18n";
import type { MenuUpdate } from "../api";
import menuGroups from "../../src-tauri/menu.json";

type MenuGroup = {
  name: string;
  commands: { id: string; title: string; shortcut: string }[];
};
type OpenMenu = { group: string; x: number; y: number };

const groups = menuGroups as MenuGroup[];

export default function MenuBar({
  commands,
  run,
}: {
  commands: MenuUpdate[];
  run(id: string): void;
}) {
  const [open, setOpen] = useState<OpenMenu>();
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const states = new Map(commands.map((item) => [item.id, item]));
  const current = open ? groups.find((group) => group.name === open.group) : undefined;

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus(),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(undefined);
      buttons.current.get(open.group)?.focus();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (barRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(undefined);
    };
    window.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open]);

  const show = (group: string) => {
    const button = buttons.current.get(group);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setOpen({ group, x: rect.left, y: rect.bottom + 4 });
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (!open) return;
      const index = groups.findIndex((group) => group.name === open.group);
      const next = groups[(index + (event.key === "ArrowRight" ? 1 : -1) + groups.length) % groups.length];
      if (next) show(next.name);
      return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    }
    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <>
      <div ref={barRef} className="menu-bar" role="menubar" aria-label={t("菜单栏")} data-tauri-drag-region="false">
        {groups.map((group) => (
          <button
            key={group.name}
            ref={(node) => {
              if (node) buttons.current.set(group.name, node);
              else buttons.current.delete(group.name);
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open?.group === group.name}
            className={open?.group === group.name ? "selected" : ""}
            onClick={() => {
              if (open?.group === group.name) setOpen(undefined);
              else show(group.name);
            }}
            onMouseEnter={() => {
              if (open) show(group.name);
            }}
          >
            {t(group.name)}
          </button>
        ))}
      </div>
      {open && current && (
        <div
          ref={menuRef}
          className="app-menu menu-bar-menu"
          style={{ left: open.x, top: open.y }}
          role="menu"
          aria-label={t(current.name)}
          data-tauri-drag-region="false"
          onKeyDown={keyDown}
        >
          {current.commands.map((command) => {
            const state = states.get(command.id);
            const shortcut = state?.shortcut || (command.id === "app.quit" ? "Alt+F4" : "");
            return (
              <button
                key={command.id}
                type="button"
                role="menuitem"
                className="app-menu-item"
                disabled={state ? !state.enabled : false}
                onClick={() => {
                  setOpen(undefined);
                  run(command.id);
                }}
              >
                <span>
                  <span className="menu-check" aria-hidden="true">
                    {state?.checked ? <Check size={13} /> : null}
                  </span>
                  {command.id === "app.about" ? `${t(command.title)}…` : t(command.title)}
                </span>
                {shortcut && <kbd>{shortcut}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
