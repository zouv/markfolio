import { Copy, FileText, FolderOpen, Info, Link, ListChecks, MapPin, Trash2 } from "lucide-react";
import { t } from "../i18n";
import * as api from "../api";
import { useApp } from "../store";
import { displayError, fileName } from "../types";

/** Note actions shared by the document list and the file tree so both menus stay identical. */
export default function NoteMenuItems({
  workspace,
  path,
  close,
  onDuplicate,
  onMove,
  onDelete,
  onProperties,
  onSelectAll,
}: {
  workspace: string;
  path: string;
  close(): void;
  onDuplicate(): void;
  onMove(): void;
  onDelete(): void;
  onProperties(): void;
  onSelectAll?(): void;
}) {
  const state = useApp();
  const mutating = useApp((value) => value.sessions[workspace]?.mutating);
  const invoke = (action: () => void) => () => {
    close();
    action();
  };
  const copy = (text: string, notice: string) => {
    void navigator.clipboard.writeText(text)
      .then(() => state.setNotice(notice))
      .catch((error) => state.setNotice(displayError(error)));
  };
  return (
    <>
      <button role="menuitem" disabled={mutating} onClick={invoke(onDuplicate)}><Copy size={15} /><span>{t("复制笔记")}</span></button>
      <button role="menuitem" disabled={mutating} onClick={invoke(onMove)}><FolderOpen size={15} /><span>{t("移动到…")}</span></button>
      <button role="menuitem" onClick={() => { close(); void api.revealEntry(workspace, path).catch((error) => state.setNotice(displayError(error))); }}><MapPin size={15} /><span>{t("在资源管理器中定位")}</span></button>
      <div className="app-menu-separator" role="separator" />
      <button role="menuitem" onClick={() => { close(); copy(fileName(path), t("名称已复制")); }}><FileText size={15} /><span>{t("复制名称")}</span></button>
      <button role="menuitem" onClick={() => { close(); copy(path, t("路径已复制")); }}><Link size={15} /><span>{t("复制相对路径")}</span></button>
      <button role="menuitem" onClick={() => { close(); void api.copyEntryPath(workspace, path).then(() => state.setNotice(t("完整路径已复制"))).catch((error) => state.setNotice(displayError(error))); }}><Copy size={15} /><span>{t("复制完整路径")}</span></button>
      <div className="app-menu-separator" role="separator" />
      <button role="menuitem" onClick={invoke(onProperties)}><Info size={15} /><span>{t("文档属性")}</span></button>
      <button role="menuitem" onClick={() => { close(); copy("markfolio://open?workspace=" + encodeURIComponent(workspace) + "&path=" + encodeURIComponent(path), t("笔记链接已复制")); }}><Link size={15} /><span>{t("复制笔记链接")}</span></button>
      {onSelectAll && <button role="menuitem" onClick={invoke(onSelectAll)}><ListChecks size={15} /><span>{t("全选文件")}</span></button>}
      <div className="app-menu-separator" role="separator" />
      <button role="menuitem" disabled={mutating} onClick={invoke(onDelete)}><Trash2 size={15} /><span>{t("移入回收站")}</span></button>
    </>
  );
}
