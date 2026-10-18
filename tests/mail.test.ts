import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertMailConfigured } from "../src/lib/env";
import { sendEmail } from "../src/lib/mail";

const KEYS = ["RESEND_API_KEY", "SMTP_HOST", "MAIL_FROM", "SMTP_FROM", "SMTP_USER", "APP_URL"] as const;
const saved: Record<string, string | undefined> = {};

describe("mail", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("sends through Resend's API when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_FROM = "OnlySongs <hello@onlysongs.io>";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail("me@example.com", { subject: "Hi", text: "Body" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_test_key");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "OnlySongs <hello@onlysongs.io>",
      to: ["me@example.com"],
      subject: "Hi",
      text: "Body",
    });
  });

  it("throws with Resend's reason when it rejects the email", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"domain is not verified"}', { status: 403 })));
    await expect(sendEmail("me@example.com", { subject: "Hi", text: "Body" })).rejects.toThrow(/403.*not verified/);
  });

  it("requires Resend or SMTP on an https:// app, and nothing locally", () => {
    process.env.APP_URL = "http://127.0.0.1:3000";
    expect(() => assertMailConfigured()).not.toThrow();
    process.env.APP_URL = "https://onlysongs.io";
    expect(() => assertMailConfigured()).toThrow(/RESEND_API_KEY/);
    process.env.RESEND_API_KEY = "re_test_key";
    expect(() => assertMailConfigured()).not.toThrow();
  });
});
