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
  schemaContractChecks[0],
  schemaContractChecks[1],
  errorHandlingChecks[0],
  errorHandlingChecks[1],
  errorHandlingChecks[2],
  typeSafetyChecks[0],
  effectBoundaryChecks[0],
  typeSafetyChecks[1],
  observabilityCatalogChecks[0],
  observabilityCatalogChecks[1],
  observabilityCatalogChecks[2],
  typeSafetyChecks[2],
  effectBoundaryChecks[1],
  effectBoundaryChecks[2],
  errorHandlingChecks[3],
  errorHandlingChecks[4],
  configChecks[0],
  dependencyChecks[0],
  dependencyChecks[1],
  architectureChecks[0],
  architectureChecks[1],
  architectureChecks[2],
];
