import { afterAll, describe, expect, it, vi } from "vitest";

const captures: Array<{
  readonly distinctId: string;
  readonly event: string;
  readonly properties: Record<string, unknown>;
}> = [];

class MockPostHog {
  constructor(_token: string, _options: Record<string, unknown>) {}

  capture(input: {
    readonly distinctId: string;
    readonly event: string;
    readonly properties: Record<string, unknown>;
  }): void {
    captures.push(input);
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

const initCalls: Array<Record<string, unknown>> = [];

vi.mock("posthog-js", () => ({
  default: {
    init(_token: string, options: Record<string, unknown>): void {
      initCalls.push(options);
    },
    capture(): void {},
  },
}));

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

vi.mock("posthog-node", () => ({ PostHog: MockPostHog }));
vi.stubEnv("WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-token");

const { captureServerEvent, captureServerEventWithoutRequest } =
  await import("../lib/posthog/server");
const { initDocsPostHog } = await import("../lib/posthog/client");

afterAll(() => {
  vi.unstubAllEnvs();
  if (originalWindowDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  }
});

describe("docs PostHog privacy boundaries", () => {
  it("uses a server-owned identity and bounded route dimensions", async () => {
    captures.length = 0;
    const request = new Request(
      "https://docs.example/api/search?query=secret@example.com&referrer=secret-referrer",
      {
        headers: {
          "x-posthog-distinct-id": "forged-user",
          referer: "https://secret.example/path?token=secret",
          "user-agent": "secret-user-agent",
        },
      },
    );

    await captureServerEvent("search_requested", request);

    expect(captures).toHaveLength(1);
    const [capture] = captures;
    expect(capture.distinctId).toBe("docs-server");
    expect(capture.properties).toMatchObject({ route: "/api/search" });
    expect(capture.properties).not.toHaveProperty("query");
    expect(capture.properties).not.toHaveProperty("search");
    expect(capture.properties).not.toHaveProperty("referrer");
    expect(capture.properties).not.toHaveProperty("user_agent");
    expect(JSON.stringify(capture.properties)).not.toContain("secret@example.com");
    expect(JSON.stringify(capture.properties)).not.toContain("secret-referrer");
    expect(JSON.stringify(capture.properties)).not.toContain("secret-user-agent");
  });

  it("does not autocapture copied feedback text", () => {
    initCalls.length = 0;
    initDocsPostHog();

    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({
      autocapture: { capture_copied_text: false },
    });
  });
  it("keeps explicit feedback content in its destination event", async () => {
    captures.length = 0;
    await captureServerEventWithoutRequest("text_feedback_submitted", {
      message: "secret feedback text",
      block_body: "secret selected documentation",
    });

    expect(captures).toHaveLength(1);
    expect(captures[0].properties).toMatchObject({
      message: "secret feedback text",
      block_body: "secret selected documentation",
    });
  });
});
