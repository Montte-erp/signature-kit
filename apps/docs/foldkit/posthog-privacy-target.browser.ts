import posthog from "posthog-js";
import { captureDocsEvent, initDocsPostHog } from "../lib/posthog/client";

document.documentElement.dataset.referrerObserved = String(
  document.referrer.includes("PUBLIC_QUERY_SENTINEL"),
);
document.documentElement.dataset.ambientTokenConfigured = String(
  Boolean(import.meta.env.WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN),
);
initDocsPostHog(
  "local-privacy-test-token",
  `${window.location.origin}/__feedback_test__/privacy-ingest`,
  { opt_out_useragent_filter: true, request_batching: false },
);
posthog.capture(
  "privacy_nested_fixture",
  {
    custom_url: "https://example.test/safe?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
    $session_entry_ph_keyword: "PUBLIC_QUERY_SENTINEL",
    $initial_ph_keyword: "PUBLIC_QUERY_SENTINEL",
    nested: {
      value: "https://example.test/path?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
      relative: "/docs/safe?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
      ftp: "ftp://user:pass@example.test/file?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
      urlObject: new URL(
        "https://example.test/object?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
      ),
      upper: "See HTTPS://example.test/upper?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
      embedded: "See https://example.test/embedded?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
    },
  },
  {
    $set_once: {
      initial_url: "https://example.test/initial?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
    },
  },
);
posthog.reloadFeatureFlags();

captureDocsEvent("privacy_set_fixture", {
  safe_object: new URL(
    "https://example.test/object?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
  ),
  $set: { nested_url: "https://example.test/path?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL" },
});
