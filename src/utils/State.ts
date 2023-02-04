// https://dev.to/ankittanna/how-to-create-a-type-for-complex-json-object-in-typescript-d81

export type JSONValue =
    | string
    | number
    | boolean
    | JSONObject
    | JSONArray;

export interface JSONObject {
    [x: string]: JSONValue;
}

export interface JSONArray extends Array<JSONValue> { }