import { cloneDeep, isEqual } from 'lodash';
import { StateClient } from './Client';

// State type - any object with any properties
type Primitives = string | number | boolean | null;
export type State = { [key: string]: Primitives | State | (Primitives | State)[] };

// RecursiveNull - makes all properties of an object null recursively, 
// except for array properties, which will be replaced by one null element
export type RecursiveNull<T> =
    // If T is a primitive, return null
    T extends string | number | boolean ? null :
    // If T is an array, replace with null
    T extends Array<infer U> ? null :
    // If T is an object, make all properties null recursively
    T extends object ? { [K in keyof T]: RecursiveNull<T[K]> } :
    // If T is anything else, return null
    null;

// RecursivePartial - makes all properties of an object optional recursively, 
// except for array properties, which will be optional but not recursively optional
export type RecursivePartial<T> =
    // If T is a primitive, return T
    T extends string | number | boolean | null ? T :
    // If T is an array, keep it as is
    T extends Array<infer U> ? T :
    // If T is an object, make all properties optional recursively
    T extends object ? { [K in keyof T]?: RecursivePartial<T[K]> } :
    // If T is anything else, return T
    T;

// DiffResult - the result of a diff operation showing whats modified (including new properties), and whats deleted
export type DiffResult<T> = {
    modified: RecursivePartial<T>;
    deleted: RecursivePartial<RecursiveNull<T>>;
};

type ValueType = 'primitive' | 'object' | 'undefined';
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

// diff - the diff function, takes two objects and returns a DiffResult
export function diff<T extends State, U extends State>(oldState: T, newState: U): DiffResult<T> {
    const modified: RecursivePartial<T> = {} as RecursivePartial<T>;
    const deleted: RecursivePartial<RecursiveNull<T>> = {} as RecursivePartial<RecursiveNull<T>>;
    // Union of all keys in both objects
    const keys = new Set([...Object.keys(oldState), ...Object.keys(newState)]) as Set<keyof T | keyof U>;
    for (const key of keys) {
        const oldType = valueType(oldState[key]);
        const newType = valueType(newState[key]);
        // If the old value is not undefined, and new value is undefined, then the property was deleted. This is the only case where we add to the deleted object
        if (oldType !== 'undefined' && newType === 'undefined') {
            // @ts-ignore - we are sure that the key exists in the old state
            deleted[key] = null;
        } else if (oldType === newType) {
            // If the types are the same, we can compare them. In the case of primitives, we can just compare them directly. In the case of objects, we need to recurse.
            if (oldType === 'primitive') {
                if (Array.isArray(oldState[key as keyof T])) {
                    // Deep equality check for arrays
                    if (!isEqual(oldState[key as keyof T], newState[key as keyof U])) {
                        // @ts-ignore - we are adding a new property to modified, so we are sure that the key exists
                        modified[key] = newState[key];
                    }
                // @ts-ignore - typescript not aware of value type?
                } else if (oldState[key as keyof T] !== newState[key as keyof U]) {
                    // @ts-ignore - same as above
                    modified[key] = newState[key];
                }
            } else if (oldType === 'object') {
                // We need to recurse
                const subDiff = diff(oldState[key as keyof T] as State, newState[key as keyof U] as State);
                // Check if subDiff has deletions
                if (Object.keys(subDiff.deleted).length > 0) {
                    // @ts-ignore - same as above
                    deleted[key] = subDiff.deleted;
                }
                if (Object.keys(subDiff.modified).length > 0) {
                    // @ts-ignore - same as above
                    modified[key] = subDiff.modified;
                }
            }
        } else {
            // If the types are different, we can't compare them, so we just add the new value to the modified object
            // @ts-ignore - we are sure that the key exists in the new state
            modified[key] = newState[key];
        }
    }
    return { modified, deleted };
}

// Recursively delete in state using delete object
function deleteInPlace<T extends State>(state: T, deleteObject: RecursivePartial<RecursiveNull<T>>) {
    for (const key of Object.keys(deleteObject)) {
        const value = deleteObject[key];
        if (value === null) {
            // @ts-ignore - we are sure that the key exists in the state
            delete state[key];
        } else {
            // @ts-ignore - we are sure that the key exists in the state
            deleteInPlace(state[key] as State, value);
        }
    }
}

// merge - takes an object and a diff to recreate the new object
export function mergeDiffInPlace<T extends State>(state: T, diff: DiffResult<T>) {
    // Merge the "modified" object into the state
    Object.assign(state, diff.modified);
    // Delete the "deleted" properties from the state
    deleteInPlace(state, diff.deleted);
}

export function mergeDiff<T extends State>(state: T, diff: DiffResult<T>): State {
    // Deep clone the state
    const newState = cloneDeep(state);
    // Merge the diff into the new state
    mergeDiffInPlace(newState, diff);
    return newState;
}