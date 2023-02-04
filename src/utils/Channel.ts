import { z } from "zod";
import { JSONObject } from "./State";

export type Channel<T extends JSONObject> = {
    name: string;
    schema: z.ZodSchema<T>;
}