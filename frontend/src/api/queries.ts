import { queryOptions } from "@tanstack/react-query";

import { api } from "./client";
import type { components } from "./generated";
import { toApiProblem } from "./problem";

export type Account = components["schemas"]["Account"];
export type Bucket = components["schemas"]["Bucket"];
export type Category = components["schemas"]["Category"];
export type Dashboard = components["schemas"]["Dashboard"];
export type ImportBatch = components["schemas"]["ImportBatch"];
export type ImportBatchSummary = components["schemas"]["ImportBatchSummary"];
export type ImportedRow = components["schemas"]["ImportedRow"];
export type ParserProfile = components["schemas"]["ParserProfile"];
export type Reconciliation = components["schemas"]["Reconciliation"];
export type ReconciliationResult = components["schemas"]["ReconciliationResult"];
export type Rule = components["schemas"]["Rule"];
export type Suggestion = components["schemas"]["Suggestion"];
export type Transaction = components["schemas"]["Transaction"];

export type ImportStatus = "uploaded" | "processing" | "ready" | "failed" | "completed";

const catalogsStaleTime = 60_000;

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  accounts: ["accounts"] as const,
  buckets: ["buckets"] as const,
  categories: ["categories"] as const,
  transactions: (limit: number, offset: number) => ["transactions", { limit, offset }] as const,
  transaction: (id: string) => ["transactions", id] as const,
  imports: (status?: ImportStatus) => ["imports", { status }] as const,
  importBatch: (id: string) => ["imports", id] as const,
  parserProfiles: ["parser-profiles"] as const,
  suggestions: (rowId: string) => ["imports", "suggestions", rowId] as const,
  reconciliations: ["reconciliations"] as const,
  rules: ["rules"] as const,
};

export const dashboardQuery = queryOptions({
  queryKey: queryKeys.dashboard,
  queryFn: async (): Promise<Dashboard> => {
    const { data, error, response } = await api.GET("/api/dashboard");
    if (error) throw toApiProblem(error, response);
    return data;
  },
});

export const accountsQuery = queryOptions({
  queryKey: queryKeys.accounts,
  staleTime: catalogsStaleTime,
  queryFn: async (): Promise<Account[]> => {
    const { data, error, response } = await api.GET("/api/accounts");
    if (error) throw toApiProblem(error, response);
    return data.items;
  },
});

export const bucketsQuery = queryOptions({
  queryKey: queryKeys.buckets,
  staleTime: catalogsStaleTime,
  queryFn: async (): Promise<Bucket[]> => {
    const { data, error, response } = await api.GET("/api/buckets");
    if (error) throw toApiProblem(error, response);
    return data.items;
  },
});

export const categoriesQuery = queryOptions({
  queryKey: queryKeys.categories,
  staleTime: catalogsStaleTime,
  queryFn: async (): Promise<Category[]> => {
    const { data, error, response } = await api.GET("/api/categories");
    if (error) throw toApiProblem(error, response);
    return data.items;
  },
});

export const transactionsQuery = (limit: number, offset: number) =>
  queryOptions({
    queryKey: queryKeys.transactions(limit, offset),
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error, response } = await api.GET("/api/transactions", {
        params: { query: { limit, offset } },
      });
      if (error) throw toApiProblem(error, response);
      return data.items;
    },
  });

export const transactionQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.transaction(id),
    queryFn: async (): Promise<Transaction> => {
      const { data, error, response } = await api.GET("/api/transactions/{id}", {
        params: { path: { id } },
      });
      if (error) throw toApiProblem(error, response);
      return data;
    },
  });

export const importsQuery = (status?: ImportStatus) =>
  queryOptions({
    queryKey: queryKeys.imports(status),
    queryFn: async (): Promise<ImportBatchSummary[]> => {
      const { data, error, response } = await api.GET("/api/imports", {
        params: { query: { status, limit: 50, offset: 0 } },
      });
      if (error) throw toApiProblem(error, response);
      return data.items;
    },
  });

export const importBatchQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.importBatch(id),
    queryFn: async (): Promise<ImportBatch> => {
      const { data, error, response } = await api.GET("/api/imports/{id}", {
        params: { path: { id } },
      });
      if (error) throw toApiProblem(error, response);
      return data;
    },
  });

export const parserProfilesQuery = queryOptions({
  queryKey: queryKeys.parserProfiles,
  staleTime: catalogsStaleTime,
  queryFn: async (): Promise<ParserProfile[]> => {
    const { data, error, response } = await api.GET("/api/parser-profiles");
    if (error) throw toApiProblem(error, response);
    return data.items;
  },
});

export const suggestionsQuery = (rowId: string) =>
  queryOptions({
    queryKey: queryKeys.suggestions(rowId),
    queryFn: async (): Promise<Suggestion[]> => {
      const { data, error, response } = await api.GET("/api/imports/rows/{id}/suggestions", {
        params: { path: { id: rowId } },
      });
      if (error) throw toApiProblem(error, response);
      return data.items;
    },
  });

export const reconciliationsQuery = queryOptions({
  queryKey: queryKeys.reconciliations,
  queryFn: async (): Promise<Reconciliation[]> => {
    const { data, error, response } = await api.GET("/api/reconciliations");
    if (error) throw toApiProblem(error, response);
    return data.items;
  },
});

export const rulesQuery = queryOptions({
  queryKey: queryKeys.rules,
  queryFn: async (): Promise<Rule[]> => {
    const { data, error, response } = await api.GET("/api/rules");
    if (error) throw toApiProblem(error, response);
    return data.items;
  },
});
