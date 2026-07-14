import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InstallCommand } from "../components/install-command";
import { localePath } from "../lib/links";

describe("client locale server rendering", () => {
  it("renders client component messages in the route locale", () => {
    const html = renderToStaticMarkup(<InstallCommand command="bun add package" locale="pt-BR" />);

    expect(localePath("/docs", "pt-BR")).toBe("/pt-BR/docs");
    expect(html).toContain('aria-label="Copiar comando de instalação"');
    expect(html).not.toContain('aria-label="Copy install command"');
  });
});
