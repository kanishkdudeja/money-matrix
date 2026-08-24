import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  const databaseURL = process.env.E2E_DATABASE_URL
    ?? process.env.TEST_DATABASE_URL
    ?? "postgres://money_matrix:money_matrix_local@localhost:4321/money_matrix_test?sslmode=disable";
  const backendDirectory = fileURLToPath(new URL("../../backend", import.meta.url));
  const migration = spawnSync(
    "go",
    ["run", "github.com/pressly/goose/v3/cmd/goose@v3.27.3", "-dir", "database/migrations", "postgres", databaseURL, "up"],
    { cwd: backendDirectory, encoding: "utf8", stdio: "pipe" },
  );
  if (migration.status !== 0) {
    throw new Error(`Could not migrate the E2E database.\n${migration.stdout}\n${migration.stderr}`);
  }
}
