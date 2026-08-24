import createClient from "openapi-fetch";

import type { paths } from "./generated";

const configuredBaseURL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const testBaseURL = import.meta.env.MODE === "test" ? "http://localhost" : "";

export const api = createClient<paths>({
  baseUrl: configuredBaseURL?.replace(/\/$/, "") ?? testBaseURL,
  headers: { Accept: "application/json" },
  fetch: (...args) => globalThis.fetch(...args),
});
