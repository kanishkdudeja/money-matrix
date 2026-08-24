import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { components } from "../../api/generated";
import { queryKeys } from "../../api/queries";
import { toApiProblem } from "../../api/problem";

export type CreateTransaction = components["schemas"]["CreateTransaction"];

async function invalidateLedgerViews(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
    queryClient.invalidateQueries({ queryKey: queryKeys.buckets }),
  ]);
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTransaction) => {
      const { data, error, response } = await api.POST("/api/transactions", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => invalidateLedgerViews(queryClient),
  });
}

export function useReverseTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { data, error, response } = await api.POST("/api/transactions/{id}/reverse", {
        params: { path: { id } },
        body: { description },
      });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => invalidateLedgerViews(queryClient),
  });
}
