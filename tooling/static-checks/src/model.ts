export type CheckContext = {
  readonly line: string;
  readonly rawLine: string;
  readonly window: string;
  readonly path: string;
  readonly source: string;
  readonly lineNumber: number;
  readonly lines: readonly string[];
  readonly rawLines: readonly string[];
};

export type Check = {
  message: string;
  test: (context: CheckContext) => boolean;
  ignoreImportLine: boolean;
};

export type RequiredSpanCall = {
  readonly name: string;
  readonly expression: string;
};
