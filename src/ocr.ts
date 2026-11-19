import { createWorker, OEM, type LoggerMessage, type Worker } from "tesseract.js";

export type OcrLanguage = "eng" | "chi_sim" | "eng+chi_sim";

/** All OCR resources are packaged with the app; no model downloads are needed. */
export function createLocalOcrWorker(language: OcrLanguage, logger?: (message: LoggerMessage) => void): Promise<Worker> {
  if (!["eng", "chi_sim", "eng+chi_sim"].includes(language)) throw new Error("Unsupported OCR language");
  return createWorker(language, OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    workerBlobURL: false,
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    logger: logger ?? (() => {}),
  });
}
