import { ClabClient } from "@clab/sdk";

export const api = new ClabClient(process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000");
