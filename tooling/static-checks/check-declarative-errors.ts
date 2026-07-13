#!/usr/bin/env bun

import { runDeclarativeChecks } from "./src/runner";

if (runDeclarativeChecks()) {
  process.exit(1);
}
