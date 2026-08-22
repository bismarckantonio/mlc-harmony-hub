import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadProfileById, reconcile } from "./mlc.server";

const inputSchema = z.object({
  trackTitle: z.string().max(300).default(""),
  iswc: z.string().max(40).default(""),
  mainArtist: z.string().max(200).default(""),
  composers: z.string().max(1000).default(""),
  publishers: z.string().max(1000).default(""),
});

export const reconcileWork = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => reconcile(data));

export const selectCandidate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    inputSchema.extend({ workId: z.coerce.number().int().positive() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { workId, ...input } = data;
    return loadProfileById(workId, input);
  });
