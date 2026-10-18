// Railway project for OnlySongs: Postgres, Redis, and the web and worker
// services built from this repo's Dockerfile. Secrets are set with
// `railway variable set` and left alone here (preserve()).
// Preview with `railway config plan`; apply with `railway config apply`.
import { defineRailway, github, postgres, preserve, project, redis, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");
  const cache = redis("redis");

  const source = github("Mithridates01/onlysongs.io", { branch: "main" });
  const build = { builder: "DOCKERFILE" as const };
  // Advisory-locked, so web and worker can both run it on the same deploy.
  const migrate = "node_modules/.bin/prisma migrate deploy";

  const web = service("web", {
    source,
    build,
    preDeploy: migrate,
    healthcheck: "/api/health",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    env: {
      PROCESS: "web",
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      ENCRYPTION_KEY: preserve(),
      APP_URL: preserve(),
      ADMIN_EMAIL: preserve(),
      // Mail goes through Resend's HTTPS API: Railway's Hobby plan blocks outbound SMTP.
      RESEND_API_KEY: preserve(),
      MAIL_FROM: preserve(),
    },
  });

  const worker = service("worker", {
    source,
    build,
    preDeploy: migrate,
    replicas: 2,
    deploy: { restartPolicyType: "ALWAYS" },
    env: {
      PROCESS: "worker",
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      // Must match web: both decrypt the same Spotify tokens.
      ENCRYPTION_KEY: web.env.ENCRYPTION_KEY,
      APP_URL: web.env.APP_URL,
      // The worker sends the Reconnect and quota emails, and refuses to start
      // on an https:// APP_URL without mail configured.
      RESEND_API_KEY: web.env.RESEND_API_KEY,
      MAIL_FROM: web.env.MAIL_FROM,
    },
  });

  return project("onlysongs", { resources: [db, cache, web, worker] });
});
