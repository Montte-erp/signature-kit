import { highlight } from "fumadocs-core/highlight";
import { CodeBlock as Container, Pre } from "fumadocs-ui/components/codeblock";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  lang: string;
  className?: string;
}

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
