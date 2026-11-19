// WebView2 installations can lag behind the browser features used by PDF.js.
if (!("withResolvers" in Promise)) {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true, writable: true,
    value: function<T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    },
  });
}
for (const method of ["transfer", "transferToFixedLength"]) {
  if (!(method in ArrayBuffer.prototype)) Object.defineProperty(ArrayBuffer.prototype, method, {
    configurable: true, writable: true,
    value: function(this: ArrayBuffer, length?: number) {
      const output = new ArrayBuffer(length === undefined ? this.byteLength : length);
      new Uint8Array(output).set(new Uint8Array(this, 0, Math.min(this.byteLength, output.byteLength)));
      if (typeof structuredClone === "function") structuredClone(this, { transfer: [this] });
      return output;
    },
  });
}
