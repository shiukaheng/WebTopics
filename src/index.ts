import { DiffResult, RecursivePartial, diff } from "./Compare";

const a = {
    test: "test",
    test2: {
        test: "test",
    },
    test3: [1, 2, 3]
}

const b = {
    test: "test b",
    test2: {},
    test3: [1, 2, 3, 4]
}

console.log(diff(a, b));