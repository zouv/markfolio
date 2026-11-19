import { t } from "../i18n";
import { useEffect, useState } from "react";
import * as api from "../api";
import { useApp } from "../store";
import { displayError } from "../types";
export default function ConflictDialog({
  workspace,
  path,
  close,
}: {
  workspace: string;
  path: string;
  close(): void;
}) {
  const state = useApp();
  const buffer = state.sessions[workspace]?.documents[path];
  const [disk, setDisk] = useState("");
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api
      .readDocument(workspace, path)
      .then((doc) => {
        setDisk(doc.text);
        setVersion(doc.version);
      })
      .catch((error) => setError(displayError(error)));
  }, [workspace, path]);
  async function keepMine() {
    if (!buffer || !version) return;
    try {
      const saved = await api.saveDocument(workspace, {
        ...buffer,
        version,
        text:
          buffer.lineEnding === "crlf"
            ? buffer.text.replace(/\n/g, "\r\n")
            : buffer.text,
      });
      const current = useApp.getState();
      const session = current.sessions[workspace];
      const latest = session?.documents[path];
      if (!latest) return;
      useApp.setState({
        sessions: {
          ...current.sessions,
          [workspace]: {
            ...session,
            documents: {
              ...session.documents,
              [path]: {
                ...latest,
                version: saved.version,
                savedText: buffer.text,
                dirty: latest.text !== buffer.text,
                error: "",
                errorCode: "",
              },
            },
          },
        },
      });
      close();
    } catch (error) {
      setError(displayError(error));
    }
  }
  return (
    <>
      <h2>{t("比较外部修改")}</h2>
      <p className="muted">{t("选择要保留的内容。替换前仍会检查磁盘版本。")}</p>
      <div className="conflict-compare">
        <section>
          <h3>{t("你的编辑")}</h3>
          <pre>{buffer?.text}</pre>
        </section>
        <section>
          <h3>{t("磁盘文件")}</h3>
          <pre>{disk}</pre>
        </section>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button
          className="secondary"
          onClick={() => {
            void state
              .reload(workspace, path)
              .then(close)
              .catch((error) => setError(displayError(error)));
          }}
        >
          {t("使用磁盘内容")}</button>
        <button
          className="primary"
          disabled={!version}
          onClick={() => void keepMine()}
        >
          {t("保留我的编辑并保存")}</button>
      </div>
    </>
  );
}
