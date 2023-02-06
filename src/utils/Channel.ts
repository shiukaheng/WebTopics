import { z } from "zod";
import { JSONValue } from "./JSON";

export type Channel<T extends JSONValue> = {
    name: string;
    schema: z.ZodSchema<T>;
}