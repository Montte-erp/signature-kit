import { expect, it, onTestFinished } from "vitest";

const receiver = "/__feedback_test__";
const source = "/__feedback_test__";
const readRequests = async (): Promise<string> =>
  JSON.stringify(await (await fetch(`${receiver}/privacy-events`)).json());

it("keeps query and fragment sentinels out of real SDK events and flag requests after HTTP navigation", async () => {
  const frame = document.createElement("iframe");
  onTestFinished(async () => {
    frame.remove();
    await fetch(`${receiver}/privacy-stop`);
  });
  expect((await fetch(`${receiver}/privacy-start`)).status).toBe(204);
  frame.src = `${source}/privacy-prelude?entry=PUBLIC_QUERY_SENTINEL&utm_campaign=PUBLIC_QUERY_SENTINEL&gclid=PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL`;
  document.body.append(frame);
  await expect.poll(() => frame.contentWindow?.location.pathname).toBe(`${source}/privacy-prelude`);
  await expect.poll(() => frame.contentDocument?.querySelector("a")).not.toBeNull();
  frame.contentDocument?.querySelector("a")?.click();
  await expect.poll(() => frame.contentWindow?.location.pathname).toBe(`${source}/privacy-source`);
  await expect
    .poll(() => frame.contentDocument?.documentElement.dataset.seeded, { timeout: 15_000 })
    .toBe("true");
  await expect
    .poll(
      async () => ({
        seed: (await readRequests()).includes("privacy_legacy_seed"),
        diagnostics: await (await fetch(`${receiver}/privacy-diagnostics`)).json(),
      }),
      { timeout: 15_000 },
    )
    .toEqual(expect.objectContaining({ seed: true }));
  const initialEntries: unknown = await (await fetch(`${receiver}/privacy-events`)).json();
  const initialEvent: unknown = Array.isArray(initialEntries)
    ? initialEntries.find(
        (entry) => typeof entry === "string" && entry.includes("privacy_legacy_seed"),
      )
    : undefined;
  expect(typeof initialEvent === "string" && initialEvent.includes("PUBLIC_QUERY_SENTINEL")).toBe(
    true,
  );
  expect(typeof initialEvent === "string" && initialEvent.includes("utm_campaign")).toBe(true);
  const initialId =
    typeof initialEvent === "string"
      ? /"distinct_id"\s*:\s*"([^"\\]+)"/.exec(initialEvent)?.[1]
      : undefined;
  expect(initialId !== undefined).toBe(true);
  await fetch(`${receiver}/privacy-reset`);
  frame.contentDocument?.querySelector("a")?.click();
  await expect.poll(() => frame.contentWindow?.location.pathname).toBe(`${source}/privacy-target`);
  expect(frame.contentWindow?.location.search.includes("PUBLIC_QUERY_SENTINEL")).toBe(true);
  expect(frame.contentWindow?.location.hash.includes("PUBLIC_FRAGMENT_SENTINEL")).toBe(true);
  await expect
    .poll(() => frame.contentDocument?.documentElement.dataset.referrerObserved)
    .toBe("true");
  expect(frame.contentDocument?.documentElement.dataset.ambientTokenConfigured).toBe(
    String(Boolean(import.meta.env.WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN)),
  );
  await expect
    .poll(
      async () => {
        const body = await readRequests();
        return (
          body.includes("privacy_nested_fixture") &&
          body.includes("privacy_set_fixture") &&
          body.includes("person_properties")
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const entries: unknown = await (await fetch(`${receiver}/privacy-events`)).json();
  const targetEvent: unknown = Array.isArray(entries)
    ? entries.find((entry) => typeof entry === "string" && entry.includes("privacy_nested_fixture"))
    : undefined;
  expect(
    typeof targetEvent === "string" && initialId !== undefined && targetEvent.includes(initialId),
  ).toBe(true);
  const exposures = Array.isArray(entries)
    ? entries
        .filter((entry) => typeof entry === "string" && entry.includes("PUBLIC_QUERY_SENTINEL"))
        .map((entry) => ({
          flags: entry.includes("person_properties"),
          eventNames: [...entry.matchAll(/"event"\s*:\s*"([^"\\]+)"/g)].map((match) =>
            /^[A-Za-z0-9_$.-]{1,80}$/.test(match[1]) ? match[1] : "other",
          ),
          legacy: entry.includes("privacy_legacy_seed"),
          keys: [...entry.matchAll(/"([^"\\]+)"\s*:\s*"[^"\\]*PUBLIC_QUERY_SENTINEL/g)].map(
            (match) => (/^[A-Za-z0-9_$.-]{1,80}$/.test(match[1]) ? match[1] : "other"),
          ),
        }))
    : ["invalid-receiver-response"];
  expect(exposures).toEqual([]);
  const body = await readRequests();
  expect(body.includes("PUBLIC_QUERY_SENTINEL")).toBe(false);
  expect(body.includes("PUBLIC_FRAGMENT_SENTINEL")).toBe(false);
  expect(body.includes("privacy_nested_fixture")).toBe(true);
  expect(body.includes("example.test/safe")).toBe(true);
  expect(body.includes("/docs/safe")).toBe(true);
  expect(body.includes("example.test/embedded")).toBe(true);
  expect(body.includes("example.test/initial")).toBe(true);
  expect(body.includes("example.test/object")).toBe(true);
  expect(body.includes("example.test/upper")).toBe(true);
  expect(body.includes("example.test/file")).toBe(true);
  expect(body.includes("user:pass")).toBe(false);
  expect(body.includes("analytics_loaded")).toBe(true);
  expect(body.includes("session_entry_referring_domain")).toBe(true);
  expect(body.includes("$initial_referrer")).toBe(true);
}, 35_000);
