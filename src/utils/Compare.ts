import { cloneDeep, isEqual } from 'lodash';
import { JSONObject, JSONValue } from './JSON';

type Primitive<U> = string | number | boolean | null | Array<U>;

/**
 * Makes all properties of an object null recursively, except for array properties, which will be replaced by one null element
 */
export type RecursiveNull<T> =
    // If T is a primitive, return null
    T extends Primitive<infer U> ? null :
    // If T is an object, make all properties null recursively
    T extends object ? { [K in keyof T]: RecursiveNull<T[K]> } :
    // If T is anything else, remove it
    never;

/**
 * Makes all properties of the type optional recursively
 */
export type RecursivePartial<T> =
    // If T is a primitive, make it optional
    T extends Primitive<infer U> ? T | undefined :
    // If T is an object, make all properties optional recursively or allow it to be undefined
    T extends object ? { [K in keyof T]?: RecursivePartial<T[K]> } | undefined :
    // If T is anything else, remove it
    never;

/**
 * The result of a diff operation showing whats modified (including new properties), and whats deleted
 */
export type DiffResult<T extends JSONValue, U extends JSONValue> = {
    // Allow modified to be a union of the two types, since we can add new properties
    /**
     * Partial of the new value, with only the modified properties
     */
    modified?: RecursivePartial<T & U>; // This only does intersection on the top level, but its a limitation of typescript
    /**
     * Null values for where properties should be deleted
     */
    deleted?: RecursivePartial<RecursiveNull<T>>;
};

/**
 * The type of a value in strings; primitive here includes arrays since we treat them as an atomic value
 */
type ValueType = 'primitive' | 'object' | 'undefined';

/**
 * Returns the type of a value
 * @param value The value to get the type of
 * @returns The type of the value
 */
function valueType(value: any): ValueType {
    if (Array.isArray(value) || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return 'primitive';
    }
    if (typeof value === 'object') {
        return 'object';
    }
    if (value === undefined) {
        return 'undefined';
    }
    throw new Error(`Unknown value type: ${value}`);
}

/**
 * Compares two primitive values, including arrays using lodash isEqual 
 */
function primitiveEqual(a: JSONValue, b: JSONValue): boolean {
    // If array, use lodash isEqual
    if (Array.isArray(a) && Array.isArray(b)) {
        return isEqual(a, b);
    } else {
        // Else, use strict equality
        return a === b;
    }
}

/**
 * Compares two JSON values and returns the difference between them
 */
export function diff<T extends JSONValue, U extends JSONValue>(oldValue: T, newValue: U): DiffResult<T, U> {
    const oldValueType = valueType(oldValue);
    const newValueType = valueType(newValue);
    let modified: RecursivePartial<T & U> | undefined;
    let deleted: RecursivePartial<RecursiveNull<T>> | undefined;
    // 9 possible cases
    // Undefined vs rest (3 cases)
    if (oldValueType === "undefined") {
        if (newValueType === "undefined") {
            // undefined - throw error, should never happen
            throw new Error("Comparing undefined with undefined. Should not happen!")
        } else {
            // else - return modified because we added a new property
            modified = newValue as RecursivePartial<T & U>;
        }
    } else if (newValueType === "undefined") {
        // rest vs undefined (2 cases, since undefined vs undefined is handled above), return deleted
        deleted = null as RecursivePartial<RecursiveNull<T>>;
    } else {
        if (oldValueType !== newValueType) {
            // If types are different (2 cases), return modified
            modified = newValue as RecursivePartial<T & U>;
        } else {
            if (oldValueType === "primitive") {
                if (!primitiveEqual(oldValue, newValue)) {
                    // If primitive and not equal, return modified
                    modified = newValue as RecursivePartial<T & U>;
                }
            } else {
                // Else (object), recurse and merge results
                // Union the keys of the two objects
                const keys = new Set([...Object.keys(oldValue as object), ...Object.keys(newValue as object)]);
                for (const key of keys) {
                    // @ts-ignore - creating new property
                    const oldSubValue = oldValue[key as string];
                    // @ts-ignore - creating new property
                    const newSubValue = newValue[key as string];
                    // Recurse
                    const subDiff = diff(oldSubValue, newSubValue);
                    // Merge the results
                    if (subDiff.modified !== undefined) {
                        // If there are any modified properties, add them to the modified object
                        // If modifiedObject is undefined, set it to an empty object
                        if (modified === undefined) {
                            modified = {} as RecursivePartial<T & U>;
                        }
                        // Add the modified property to the modified object
                        (modified as any)[key] = subDiff.modified as RecursivePartial<T & U>;
                    }
                    if (subDiff.deleted !== undefined) {
                        // If there are any deleted properties, add them to the deleted object
                        // If deletedObject is undefined, set it to an empty object
                        if (deleted === undefined) {
                            deleted = {} as RecursivePartial<RecursiveNull<T>>;
                        }
                        // Add the deleted property to the deleted object
                        (deleted as any)[key] = subDiff.deleted as RecursivePartial<RecursiveNull<T>>;
                    }
                }
            }
        }
    }
    return { modified, deleted };
}

// A valid Diff should not have a property in both modified and deleted, but our function will be lenient and allow it by applying deleted first, then modified

/**
 * Merges a diff result into an old value to get a new value
 */
export function mergeDiff<T extends JSONValue, U extends JSONValue>(oldValue: T | undefined, diff: DiffResult<T, U>): any {
    // @ts-ignore - temporary fix for type bug
    const deleted = recursiveDelete(oldValue, diff.deleted);
    const modified = recursiveMerge(deleted as JSONValue | undefined, diff.modified);
    return modified;
}

/**
 * Recursively deletes properties from an object in place with a delete object in the diff format
 */
export function recursiveDelete<T extends JSONValue>(oldValue: T | undefined, deleteObject: RecursivePartial<RecursiveNull<T>>): RecursivePartial<T | undefined> {
    // Get the type of the old value
    const deleteObjectType = valueType(deleteObject);
    if (deleteObjectType === "undefined") {
        // If deleteObject is undefined, return the old value - since it means we should not delete anything
        return oldValue as RecursivePartial<T>;
    } else if (deleteObject === null) {
        // If deleteObject is null then we should delete the old value, so return undefined
        return undefined as RecursivePartial<T>;
    } else if (deleteObjectType === "primitive") {
        // If deleteObject is a primitive, it should have been null and we should have returned above, so throw an error
        throw new Error("deleteObject is a primitive, should not happen!");
    } else if (oldValue === undefined) {
        // If oldValue is undefined, then we should return undefined
        return undefined as RecursivePartial<T>; 
    } else {
        // Else, deleteObject is an object, so we need to recurse
        const result: RecursivePartial<T> = {} as RecursivePartial<T>;
        for (const key of Object.keys(oldValue as any)) {
            (result as any)[key] = recursiveDelete((oldValue as any)[key], (deleteObject as any)[key]);
            // If the result is undefined, delete the property
            if ((result as any)[key] === undefined) {
                delete (result as any)[key];
            }
        }
        return result;
    }
}

// export function recursiveDelete<T extends JSONValue>(oldValue: T | undefined, deleteObject: RecursivePartial<RecursiveNull<T>>): RecursivePartial<T | undefined> {
//     // Get the type of the old value
//     const deleteObjectType = valueType(deleteObject);
//     if (deleteObjectType === "undefined") {
//         // If deleteObject is undefined, return the old value
//         return oldValue as RecursivePartial<T>;
//     } else if (deleteObjectType === "primitive") {
//         // If deleteObject is primitive, it implies that it is null and we should delete the old value, so return undefined
//         return undefined as RecursivePartial<T>;
//     } else {
//         // Else, deleteObject is an object, so we need to recurse
//         const result: RecursivePartial<T> = {} as RecursivePartial<T>;
//         for (const key of Object.keys(deleteObject as object)) {
//             (result as any)[key] = recursiveDelete((oldValue as any)[key], (deleteObject as any)[key]);
//             // If the result is undefined, delete the property
//             if ((result as any)[key] === undefined) {
//                 delete (result as any)[key];
//             }
//         }
//         return result;
//     }
// }

/**
 * Recursively merges two objects in place with a merge object in the diff format
 */
function recursiveMerge<T extends JSONValue, U extends JSONValue>(oldValue: T | undefined, mergeObject: RecursivePartial<T & U>): RecursivePartial<T & U> {
    // Get the type of the old value
    const oldValueType = valueType(oldValue);
    const mergeObjectType = valueType(mergeObject);
    // 9 possible cases
    // Types are different (6 cases)
    if (oldValueType !== mergeObjectType) {
        if (oldValueType === "undefined") {
            // If old value is undefined, return the merge object
            return mergeObject as RecursivePartial<T & U>;
        } else {
            return oldValue as RecursivePartial<T & U>;
        }
    } else {
        // Types are the same (3 cases)
        if (oldValueType === "undefined" || oldValueType === "primitive") {
            return mergeObject as RecursivePartial<T & U>;
        } else {
            // Else, both are objects, so we need to recurse
            // Deep copy the old value
            const result: RecursivePartial<T & U> = cloneDeep(oldValue) as RecursivePartial<T & U>;
            // Merge the mergeObject into the result
            for (const key of Object.keys(mergeObject as object)) {
                (result as any)[key] = recursiveMerge((oldValue as any)[key], (mergeObject as any)[key]);
            }
            return result;
        }
    }
}