import { Marquee } from "@/components/ui/marquee";

import { LogoPill, PROVIDERS } from "./provider-marks";

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
