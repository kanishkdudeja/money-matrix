import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api/client";
import type { components } from "../../api/generated";
import { queryKeys } from "../../api/queries";
import { toApiProblem } from "../../api/problem";
import type { CSVMapping } from "./csv-mapping";

type Categorization = components["schemas"]["Categorization"];

export type CSVUpload = {
  accountId: string;
  file: File;
  mapping?: CSVMapping;
  profileId?: string;
};

async function invalidateImportViews(queryClient: ReturnType<typeof useQueryClient>, batchId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["imports"] }),
    batchId ? queryClient.invalidateQueries({ queryKey: queryKeys.importBatch(batchId) }) : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
    queryClient.invalidateQueries({ queryKey: queryKeys.buckets }),
  ]);
}

export function useUploadCSV() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, file, mapping, profileId }: CSVUpload) => {
      const formData = new FormData();
      formData.set("accountId", accountId);
      formData.set("file", file);
      if (profileId) formData.set("profileId", profileId);
      else if (mapping) formData.set("mapping", JSON.stringify(mapping));

      const { data, error, response } = await api.POST("/api/imports/csv", {
        body: formData as never,
        bodySerializer: (body) => body as FormData,
      });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => invalidateImportViews(queryClient),
  });
}

export function useCategorizeImportedRow(batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rowId, body }: { rowId: string; body: Categorization }) => {
      const { data, error, response } = await api.PUT("/api/imports/rows/{id}/categorization", {
        params: { path: { id: rowId } },
        body,
      });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => invalidateImportViews(queryClient, batchId),
  });
}

export function useSkipImportedRow(batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rowId: string) => {
      const { error, response } = await api.POST("/api/imports/rows/{id}/skip", {
        params: { path: { id: rowId } },
      });
      if (error) throw toApiProblem(error, response);
    },
    onSuccess: async () => invalidateImportViews(queryClient, batchId),
  });
}
