import { useEffect, useRef } from "react";
import { Image, FileText, FileCode2 } from "lucide-react";
import type { PluginPanel } from "../plugins/runtime";
export const markdownFile = (path: string) =>
  /\.(md|markdown|txt)$/i.test(path);
export function IconForFile({ path }: { path: string }) {
  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path) ? (
    <Image size={15} />
  ) : markdownFile(path) ? (
    <FileText size={15} />
  ) : (
    <FileCode2 size={15} />
  );
}
export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Panel({ panel }: { panel: PluginPanel }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const cleanup = panel.render(container.current);
    return () => cleanup?.();
  }, [panel]);
  return (
    <section className="plugin-panel">
      <h3>{panel.title}</h3>
      <div ref={container} />
    </section>
  );
}
