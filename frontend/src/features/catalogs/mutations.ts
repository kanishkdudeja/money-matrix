import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { components } from "../../api/generated";
import { queryKeys } from "../../api/queries";
import { toApiProblem } from "../../api/problem";

type CreateAccount = components["schemas"]["CreateAccount"];
type CreateBucket = components["schemas"]["CreateBucket"];
type CreateCategory = components["schemas"]["CreateCategory"];

function requireNoContent(error: unknown, response: Response): void {
  if (error) throw toApiProblem(error, response);
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateAccount) => {
      const { data, error, response } = await api.POST("/api/accounts", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
}

export function useSetAccountArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const path = archived ? "/api/accounts/{id}/archive" : "/api/accounts/{id}/unarchive";
      const { error, response } = await api.POST(path, { params: { path: { id } } });
      requireNoContent(error, response);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateBucket) => {
      const { data, error, response } = await api.POST("/api/buckets", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.buckets });
    },
  });
}

export function useSetBucketArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const path = archived ? "/api/buckets/{id}/archive" : "/api/buckets/{id}/unarchive";
      const { error, response } = await api.POST(path, { params: { path: { id } } });
      requireNoContent(error, response);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.buckets });
    },
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCategory) => {
      const { data, error, response } = await api.POST("/api/categories", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
  });
}

export function useSetCategoryArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const path = archived ? "/api/categories/{id}/archive" : "/api/categories/{id}/unarchive";
      const { error, response } = await api.POST(path, { params: { path: { id } } });
      requireNoContent(error, response);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
  });
}
