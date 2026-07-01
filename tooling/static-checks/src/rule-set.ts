import type { Check } from "./model";
import { schemaContractChecks } from "./rules/schema-contracts";
import { errorHandlingChecks } from "./rules/error-handling";
import { typeSafetyChecks } from "./rules/type-safety";
import { effectBoundaryChecks } from "./rules/effect-boundaries";
import { observabilityCatalogChecks } from "./rules/observability-catalogs";
import { configChecks } from "./rules/config";
import { dependencyChecks } from "./rules/dependencies";
import { architectureChecks } from "./rules/architecture";

export const checks: readonly Check[] = [
  ...schemaContractChecks,
  ...errorHandlingChecks,
  ...typeSafetyChecks,
  ...effectBoundaryChecks,
  ...observabilityCatalogChecks,
  ...configChecks,
  ...dependencyChecks,
  ...architectureChecks,
];
