"use client";

import posthog, { type CaptureResult, type PostHogConfig, type Properties } from "posthog-js";
import { installFeedbackSelection } from "../../foldkit/feedback";

import { DOCS_ANALYTICS_EVENT_PREFIX, docsAnalyticsProperties, docsEventName } from "./events";

const POSTHOG_PROJECT_TOKEN = import.meta.env.WAKU_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = import.meta.env.WAKU_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

const sanitizeUrl = (value: string): string => {
  if (value.startsWith("//") && URL.canParse(`https:${value}`)) {
    const url = new URL(`https:${value}`);
    return `//${url.host}${url.pathname}`;
  }
  if (!URL.canParse(value)) {
    const boundary = value.search(/[?#]/);
    return boundary < 0 ? value : value.slice(0, boundary);
  }
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
};

const sanitizeAnalyticsValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === "string") {
    if (
      URL.canParse(value) ||
      value.startsWith("/") ||
      value.startsWith("./") ||
      value.startsWith("../")
    )
      return sanitizeUrl(value);
    return value.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, sanitizeUrl);
  }
  if (typeof value !== "object" || value === null) return value;
  const kind = Object.prototype.toString.call(value);
  if (kind === "[object URL]") {
    if ("href" in value && typeof value.href === "string") return sanitizeUrl(value.href);
    return undefined;
  }
  if (kind === "[object Date]") return value;
  if (seen.has(value)) return undefined;
  if (Array.isArray(value)) {
    seen.add(value);
    const sanitized = value.map((item) => sanitizeAnalyticsValue(item, seen));
    seen.delete(value);
    return sanitized;
  }
  if (kind !== "[object Object]") return undefined;
  seen.add(value);
  const sanitized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "ph_keyword" && !key.endsWith("_ph_keyword"))
      .map(([key, item]) => [key, sanitizeAnalyticsValue(item, seen)]),
  );
  seen.delete(value);
  return sanitized;
};

const sanitizeAnalyticsProperties = (properties: Record<string, unknown>, seen: WeakSet<object>) =>
  Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => key !== "ph_keyword" && !key.endsWith("_ph_keyword"))
      .map(([key, value]) => [key, sanitizeAnalyticsValue(value, seen)]),
  );

const enrichEvent = (event: CaptureResult | null): CaptureResult | null => {
  if (event === null) return null;
  const seen = new WeakSet<object>();
  const properties = sanitizeAnalyticsProperties(event.properties, seen);
  return {
    ...event,
    ...(event.$set === undefined ? {} : { $set: sanitizeAnalyticsProperties(event.$set, seen) }),
    ...(event.$set_once === undefined
      ? {}
      : { $set_once: sanitizeAnalyticsProperties(event.$set_once, seen) }),
    properties: {
      ...properties,
      ...docsAnalyticsProperties("client"),
      original_posthog_event: event.event,
    },
  };
};

export const docsPostHogOptions = {
  api_host: POSTHOG_HOST,
  defaults: "2026-05-30",
  disable_capture_url_hashes: true,
  mask_personal_data_properties: true,
  custom_personal_data_properties: [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gad_source",
    "mc_cid",
  ],
  save_referrer: false,
  save_campaign_params: false,
  capture_pageview: "history_change",
  capture_pageleave: "if_capture_pageview",
  autocapture: {
    dom_event_allowlist: ["click", "change", "submit"],
    element_allowlist: ["a", "button", "form", "input", "select", "textarea", "label"],
    css_selector_ignorelist: [
      ".ph-no-autocapture",
      "[data-ph-no-autocapture]",
      "[data-analytics-sensitive]",
    ],
    element_attribute_ignorelist: ["value"],
    capture_copied_text: false,
  },
  rageclick: true,
  capture_dead_clicks: true,
  capture_exceptions: true,
  disable_session_recording: false,
  capture_performance: {
    network_timing: true,
    web_vitals: true,
    web_vitals_attribution: true,
  },
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: "[data-analytics-sensitive], .ph-mask",
    blockSelector: "[data-ph-no-capture], .ph-no-capture",
    recordHeaders: false,
    recordBody: false,
    maskCapturedNetworkRequestFn: (request) => ({ ...request, name: sanitizeUrl(request.name) }),
    captureCanvas: { recordCanvas: false },
  },
  before_send: enrichEvent,
  loaded: (client) => {
    for (const key of ["$initial_person_info", "$initial_referrer_info", "$client_session_props"]) {
      const previous = client.get_property(key);
      client.unregister(key);
      if (typeof previous === "object" && previous !== null && !Array.isArray(previous))
        client.register({ [key]: sanitizeAnalyticsValue(previous, new WeakSet<object>()) });
    }
    client.unregister("$initial_campaign_params");
    client.unregister("$stored_person_properties");
    client.setPersonPropertiesForFlags({ $initial_ph_keyword: null }, false);
    client.register(docsAnalyticsProperties("client"));
    client.capture(docsEventName("analytics_loaded"), {
      event_prefix: DOCS_ANALYTICS_EVENT_PREFIX,
    });
  },
} satisfies Partial<PostHogConfig>;

export const initDocsPostHog = (
  token = POSTHOG_PROJECT_TOKEN,
  host = POSTHOG_HOST,
  options: Partial<Pick<PostHogConfig, "opt_out_useragent_filter" | "request_batching">> = {},
): void => {
  if (typeof document !== "undefined") installFeedbackSelection(document);
  if (typeof window === "undefined" || token === undefined || token.length === 0) {
    return;
  }

  posthog.init(token, { ...docsPostHogOptions, api_host: host, ...options });
};

export const captureDocsEvent = (event: string, properties?: Properties): void => {
  posthog.capture(docsEventName(event), {
    ...docsAnalyticsProperties("client"),
    ...sanitizeAnalyticsProperties(properties ?? {}, new WeakSet<object>()),
  });
};
