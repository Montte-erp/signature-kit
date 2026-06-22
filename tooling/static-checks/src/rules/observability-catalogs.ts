import type { Check, CheckContext } from "../model";
import { isCatalogFile } from "./shared";

const hasInlineMetricName = (context: CheckContext): boolean =>
  !context.path.endsWith("/observability.ts") &&
  /\bMetric\.(?:counter|gauge|histogram|frequency|summary|timer)\s*\(\s*["']/.test(context.rawLine);

const hasInlineObservabilityLiteral = (context: CheckContext): boolean =>
  !isCatalogFile(context.path) &&
  /\b(?:Effect\.withSpan|Effect\.log(?:Info|Warning|Error|Debug)?|Metric\.(?:counter|gauge|histogram|frequency|summary|timer))\s*\(\s*["'](?:signature-kit\.)/.test(
    context.rawLine,
  );

const hasDomainMagicString = (context: CheckContext): boolean =>
  !isCatalogFile(context.path) &&
  /\b(?:code|operation|phase|schemaName|name)\s*:\s*["'](?:signature-kit\.|[a-z]+(?:\.[a-z_]+)+|[A-Z][A-Za-z0-9]+)[^"']*["']/.test(
    context.rawLine,
  );

export const observabilityCatalogChecks: readonly Check[] = [
  {
    message: "Effect metrics must use a *MetricNameValue catalog; do not inline the name.",
    test: hasInlineMetricName,
    ignoreImportLine: true,
  },
  {
    message: "Observable signature-kit. strings must come from a catalog, not inline in the flow.",
    test: hasInlineObservabilityLiteral,
    ignoreImportLine: true,
  },
  {
    message:
      "Domain strings in code/operation/phase/schemaName/name must come from typed catalogs.",
    test: hasDomainMagicString,
    ignoreImportLine: true,
  },
];
