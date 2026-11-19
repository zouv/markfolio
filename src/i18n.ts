import { useSyncExternalStore } from "react";
import { english } from "./translations";
export type Locale = "zh-CN" | "en";
let locale: Locale = "zh-CN";
const listeners = new Set<() => void>();
export function setLocale(next: Locale) { if(next!==locale){locale=next;if(typeof document!=="undefined")document.documentElement.lang=next;listeners.forEach(fn=>fn());} }
export function useLocale(): Locale { return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},()=>locale); }
export function t(message: string, ...values: unknown[]): string {
  const translated = locale === "en" ? english[message] ?? message : message;
  return translated.replace(/\{(\d+)\}/g, (match,index: string)=>Number(index)<values.length?String(values[Number(index)]??""):match);
}
