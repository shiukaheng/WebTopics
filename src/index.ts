import { DiffResult, RecursivePartial, diff } from "./client/Compare";

const a = {
    test: "test",
    test2: {
        test: "test",
    }
}

const b = {
    test: "test b",
    test2: {}
}

console.log(diff(a, b));