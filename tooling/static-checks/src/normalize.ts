type LexMode =
  | "code"
  | "line-comment"
  | "block-comment"
  | "single-quote"
  | "double-quote"
  | "template";

const lex = (source: string, removeQuotedText: boolean): string => {
  let mode: LexMode = "code";
  let escaped = false;
  let output = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (mode === "line-comment") {
      if (character === "\n" || character === "\r") {
        mode = "code";
        output += character;
      } else {
        output += " ";
      }
      continue;
    }

    if (mode === "block-comment") {
      if (character === "*" && next === "/") {
        mode = "code";
        output += "  ";
        index += 1;
      } else {
        output += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }

    if (mode === "single-quote" || mode === "double-quote" || mode === "template") {
      if (escaped) {
        escaped = false;
        output +=
          character === "\n" || character === "\r" ? character : removeQuotedText ? " " : character;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        output += removeQuotedText ? " " : character;
        continue;
      }
      const closingQuote = mode === "single-quote" ? "'" : mode === "double-quote" ? '"' : "`";
      if (character === closingQuote) {
        mode = "code";
      }
      output +=
        character === "\n" || character === "\r" ? character : removeQuotedText ? " " : character;
      continue;
    }

    if (character === "/" && next === "/") {
      mode = "line-comment";
      output += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      mode = "block-comment";
      output += "  ";
      index += 1;
      continue;
    }
    if (character === "'") {
      mode = "single-quote";
      output += removeQuotedText ? " " : character;
      continue;
    }
    if (character === '"') {
      mode = "double-quote";
      output += removeQuotedText ? " " : character;
      continue;
    }
    if (character === "`") {
      mode = "template";
      output += removeQuotedText ? " " : character;
      continue;
    }
    output += character;
  }

  return output;
};

export const normalizeSource = (source: string): string => lex(source, true);
