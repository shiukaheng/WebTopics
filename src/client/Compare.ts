// RecursiveNull - makes all properties of an object null recursively, 
// except for array properties, which will be replaced by one null element

// RecursivePartial - makes all properties of an object optional recursively, 
// except for array properties, which will be optional but not recursively optional

// DiffResult - the result of a diff operation showing whats modified (including new properties), and whats deleted

// diff - the diff function, takes two objects and returns a DiffResult

// merge - takes an object and a diff to recreate the new object