import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load the repo-root .env into process.env so live provider tests read real
// sandbox credentials in every worker. No-op when the file is absent (CI).
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
