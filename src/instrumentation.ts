import type { Instrumentation } from "next";

// Runs once when the Next.js server starts. Node-only code sits inside the
// NEXT_RUNTIME check so the edge build drops it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertMailConfigured } = await import("./lib/env");
    assertMailConfigured();
    const { initSentry } = await import("./lib/sentry");
    initSentry("web");
  }
}

// Next calls this for errors thrown while rendering pages and running routes.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureError } = await import("./lib/sentry");
    captureError(error, {
      path: request.path.split("?")[0],
      method: request.method,
      route: context.routePath,
      kind: context.routeType,
    });
  }
};
