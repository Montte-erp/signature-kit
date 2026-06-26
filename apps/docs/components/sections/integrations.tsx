import { Marquee } from "@/components/ui/marquee";

import { LogoPill, PROVIDERS } from "./provider-marks";

/**
 * Remote-signers trust strip: a single edge-masked marquee of the real provider
 * logos SignatureKit ships an adapter for. Sits just under the hero as a quiet
 * "one SDK, every signer" signal; the full per-provider snippets live later in
 * <ProvidersShowcase>. Server component — pure-CSS motion, real greyscaled logos.
 */
export function Integrations() {
  const items = PROVIDERS.map((brand) => ({
    key: brand.domain,
    node: <LogoPill brand={brand} />,
  }));

  return (
    <section className="border-y border-border bg-card/20">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Marquee items={items} durationSeconds={36} />
      </div>
    </section>
  );
}
