import { highlight } from "fumadocs-core/highlight";
import { CodeBlock as Container, Pre } from "fumadocs-ui/components/codeblock";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  lang: string;
  // Forwarded to the figure. Lets callers strip the default chrome (border,
  // rounding, background) so the block can sit inside another container.
  className?: string;
}

/**
 * Server-highlighted code block. Uses the same shiki path and Vitesse themes
 * as the docs (see source.config.ts), so there's no client-side flash and the
 * landing matches the documentation. `defaultColor: false` emits only
 * --shiki-light / --shiki-dark vars, so the pinned `.dark` theme applies.
 */
export const CodeBlock = ({ code, lang, className }: CodeBlockProps) =>
  highlight(code, {
    components: {
      pre: (props: ComponentProps<"pre">) => (
        <Container {...props} className={cn(props.className, className)}>
          <Pre>{props.children}</Pre>
        </Container>
      ),
    },
    defaultColor: false,
    lang,
    themes: {
      dark: "vitesse-dark",
      light: "vitesse-light",
    },
  });
