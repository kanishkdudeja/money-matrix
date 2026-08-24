import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api/client";
import { queryKeys } from "../../api/queries";
import { toApiProblem } from "../../api/problem";
import type { CreateParserProfile } from "./profile-model";

export function useCreateParserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateParserProfile) => {
      const { data, error, response } = await api.POST("/api/parser-profiles", { body });
      if (error) throw toApiProblem(error, response);
      return data;
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.parserProfiles }),
  });
}
