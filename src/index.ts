import { DiffResults, RecursivePartial, diff } from "./client/Compare";

const a = {
    test: "test",
    test2: {
        test: "test",
    }
}

const b = {
    test: "test"
}

console.log(diff(a, b));