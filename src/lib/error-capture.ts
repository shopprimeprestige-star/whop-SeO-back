let lastCapturedError: unknown = undefined;

function capture(err: unknown) {
  lastCapturedError = err;
}

if (typeof globalThis !== "undefined") {
  try {
    // @ts-ignore
    globalThis.addEventListener?.("error", (e: any) => capture(e?.error ?? e));
    // @ts-ignore
    globalThis.addEventListener?.("unhandledrejection", (e: any) => capture(e?.reason ?? e));
  } catch {}
}

export function consumeLastCapturedError(): unknown {
  const e = lastCapturedError;
  lastCapturedError = undefined;
  return e;
}
