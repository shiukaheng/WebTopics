export type JSONValue =
    | string
    | number
    | boolean
    | JSONObject
    | JSONArray
    | null;

export type JSONArray = JSONValue[];

export interface JSONObject {
    [x: string]: JSONValue;
};

export type Encodable = JSONValue | undefined;