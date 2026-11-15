// Error reporting to Sentry for the web server and the worker. Off unless
// SENTRY_DSN is set. Errors only (no performance tracing), and no cookies,
// headers or bodies leave the server, so the free plan's quota and users'
// data are both safe.
import * as Sentry from "@sentry/node";
import { setErrorReporter } from "./log";

let started = false;

export function initSentry(role: "web" | "worker"): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || started) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    serverName: role,
    // Nothing about the person or their request beyond the path.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        if (event.request.url) event.request.url = event.request.url.split("?")[0];
      }
      return event;
    },
  });
  Sentry.setTag("role", role);
  // Errors the app handles and logs (a failed email, a schedule that couldn't
  // be saved) never throw, so they reach Sentry through log.error.
  setErrorReporter((msg, extra) => {
    Sentry.captureMessage(msg, { level: "error", extra });
  });
}

export function captureError(error: unknown, extra?: Record<string, unknown>): void {
  if (started) Sentry.captureException(error, { extra });
}

export async function flushSentry(): Promise<void> {
  if (started) await Sentry.flush(2000);
}
