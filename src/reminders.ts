import { t } from "./i18n";
import { useApp } from "./store";
import { notifyReminder, isTauriRuntime } from "./api";
import { readMetadata } from "./metadata";
import { displayError } from "./types";
const notified = new Map<string,string>();
export function checkReminders(now=Date.now()) {
  const state=useApp.getState();
  for(const [workspace,session] of Object.entries(state.sessions))for(const note of session.catalog??[]) {
    const meta=session.documents[note.path]?readMetadata(session.documents[note.path].text):note.metadata;
    const key=`${workspace}:${note.path}`;const deadline=Date.parse(meta.due);
    if(!meta.todo||meta.completed||!Number.isFinite(deadline)||deadline>now){notified.delete(key);continue;}
    if(notified.get(key)===meta.due)continue;notified.set(key,meta.due);
    state.setNotice(t("待办到期：{0}", meta.title||note.title));
    if(isTauriRuntime())void notifyReminder(meta.title||note.title).catch(error=>state.setNotice(displayError(error)));
  }
}
