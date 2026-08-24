import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { components } from "../../api/generated";
import { queryKeys } from "../../api/queries";
import { toApiProblem } from "../../api/problem";

type CreateReconciliation = components["schemas"]["CreateReconciliation"];

export function useCreateReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateReconciliation) => {
      const { data, error, response } = await api.POST("/api/reconciliations", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.reconciliations }),
  });
}

export function useCompleteReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await api.POST("/api/reconciliations/{id}/complete", { params: { path: { id } } });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.reconciliations }),
  });
}

export function useReopenReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await api.POST("/api/reconciliations/{id}/reopen", { params: { path: { id } } });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.reconciliations }),
  });
}

export function useDiscardReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await api.DELETE("/api/reconciliations/{id}", { params: { path: { id } } });
      if (error) throw toApiProblem(error, response);
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.reconciliations }),
  });
}
