import { z } from "zod";
import { ArtifactType } from "@clab/domain";

export const ArtifactManifestSchema = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  taskRunId: z.string().uuid().optional(),
  type: ArtifactType,
  uri: z.string(),
  mimeType: z.string().optional(),
  hash: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
