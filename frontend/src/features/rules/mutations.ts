import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { components } from "../../api/generated";
import { queryKeys } from "../../api/queries";
import { toApiProblem } from "../../api/problem";

type CreateRule = components["schemas"]["CreateRule"];

export function useCreateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateRule) => {
      const { data, error, response } = await api.POST("/api/rules", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await api.DELETE("/api/rules/{id}", { params: { path: { id } } });
      if (error) throw toApiProblem(error, response);
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
  });
}
