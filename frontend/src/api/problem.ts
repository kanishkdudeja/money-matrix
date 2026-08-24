import type { components } from "./generated";

type ProblemBody = components["schemas"]["Problem"];

export class ApiProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly errors?: Record<string, string>;

  constructor(problem: ProblemBody, responseStatus?: number) {
    super(problem.detail ?? problem.title);
    this.name = "ApiProblem";
    this.status = problem.status || responseStatus || 500;
    this.type = problem.type;
    this.errors = problem.errors;
  }
}

export function toApiProblem(error: unknown, response: Response): ApiProblem {
  if (isProblem(error)) {
    return new ApiProblem(error, response.status);
  }

  return new ApiProblem(
    {
      type: "about:blank",
      title: response.statusText || "Request failed",
      status: response.status,
      detail: "Money Matrix could not complete that request.",
    },
    response.status,
  );
}

function isProblem(value: unknown): value is ProblemBody {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProblemBody>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}
