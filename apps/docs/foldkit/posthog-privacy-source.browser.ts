import posthog from "posthog-js";
import { docsPostHogOptions } from "../lib/posthog/client";

posthog.init("local-privacy-test-token", {
  ...docsPostHogOptions,
  api_host: `${window.location.origin}/__feedback_test__/privacy-ingest`,
  save_referrer: true,
  save_campaign_params: true,
  disable_capture_url_hashes: false,
  mask_personal_data_properties: false,
  capture_pageview: false,
  capture_pageleave: false,
  request_batching: false,
  advanced_disable_flags: true,
  advanced_disable_decide: true,
  opt_out_useragent_filter: true,
  before_send: undefined,
  loaded: () => {},
});
posthog.reset();
posthog.register({
  $initial_person_info: {
    r: "https://www.google.com/search?q=PUBLIC_QUERY_SENTINEL",
    u: window.location.href,
  },
});
posthog.capture("privacy_legacy_seed");
void posthog.shutdown().then(() => {
  document.documentElement.dataset.seeded = "true";
});
