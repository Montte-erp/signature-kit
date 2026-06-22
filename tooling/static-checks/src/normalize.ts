export const stripQuotedText = (line: string): string =>
  line
    .replace(/"([^"\\]|\\.)*"/g, "")
    .replace(/'([^'\\]|\\.)*'/g, "")
    .replace(/`([^`\\]|\\.)*`/g, "");

export const stripLineComment = (line: string): string => {
  const delimiter = line.indexOf("//");
  return delimiter === -1 ? line : line.slice(0, delimiter);
};

export const stripBlockComments = (line: string): string => {
  let remaining = line;
  while (true) {
    const start = remaining.indexOf("/*");
    if (start === -1) break;

    const end = remaining.indexOf("*/", start + 2);
    remaining =
      end === -1 ? remaining.slice(0, start) : remaining.slice(0, start) + remaining.slice(end + 2);
  }
  return remaining;
};

export const normalizeLine = (line: string): string =>
  stripLineComment(stripBlockComments(stripQuotedText(line))).trimEnd();

export const stripSourceComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
