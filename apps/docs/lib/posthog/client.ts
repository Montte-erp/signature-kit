"use client";

import posthog, { type CaptureResult, type Properties } from "posthog-js";

import {
  DOCS_ANALYTICS_EVENT_PREFIX,
  docsAnalyticsProperties,
  docsEventName,
} from "@/lib/posthog/events";

const POSTHOG_PROJECT_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

const POSTHOG_CONFIGURED =
  POSTHOG_PROJECT_TOKEN !== undefined && POSTHOG_PROJECT_TOKEN.length > 0;

const enrichEvent = (event: CaptureResult | null): CaptureResult | null => {
  if (event === null) return null;

  return {
    ...event,
    properties: {
      ...event.properties,
      ...docsAnalyticsProperties("client"),
      original_posthog_event: event.event,
    },
  };
};

export const initDocsPostHog = (): void => {
  if (typeof window === "undefined" || !POSTHOG_CONFIGURED || POSTHOG_PROJECT_TOKEN === undefined) {
    return;
  }

  posthog.init(POSTHOG_PROJECT_TOKEN, {
    api_host: POSTHOG_HOST,
    defaults: "2026-05-30",
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
      capture_copied_text: true,
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
      captureCanvas: { recordCanvas: false },
    },
    before_send: enrichEvent,
    loaded: (client) => {
      client.register(docsAnalyticsProperties("client"));
      client.capture(docsEventName("analytics_loaded"), {
        event_prefix: DOCS_ANALYTICS_EVENT_PREFIX,
      });
    },
  });
};

export const captureDocsEvent = (event: string, properties?: Properties): void => {
  if (!POSTHOG_CONFIGURED) return;

  posthog.capture(docsEventName(event), {
    ...docsAnalyticsProperties("client"),
    ...properties,
  });
};
