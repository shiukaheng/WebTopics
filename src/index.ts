import { DiffResult, RecursivePartial, diff } from "./Compare";
import { z } from "zod";
import { Channel, StateClient } from "./Client";
// Import socket.io server
import { Server } from "socket.io";
import { TestStateClient } from "./TestClient";

const testSchema = z.object({
    a: z.string(),
    b: z.number(),
});

const testChannel = {
    name: "test",
    schema: testSchema
}

// Create a socket.io server
const io = new Server(3000);

// // Connect to the socket.io server using the StateClient
// const client = new StateClient("http://localhost:3000");
// client.addStateChannel(testChannel, (state) => {
//     console.log("Client 1 - state updated:", state);
// });

// const client2 = new StateClient("http://localhost:3000");
// client2.addStateChannel(testChannel, (state) => {
//     console.log("Client 2 - state updated:", state);
// });

// // Make client 1 update the state every second
// setInterval(() => {
//     const newState = {
//         a: "test",
//         b: Math.random()
//     }
//     client.updateState(testChannel, newState);
//     // console.log("Client 1 - state updated:", newState);
// }, 1000);

// // Server: Log all messages on the test channel
// io.on("connection", (socket) => {
//     socket.on("ch-"+testChannel.name, (message) => {
//         console.log("Server - received message:", message);
//     });
// });

const testClient = new TestStateClient("http://localhost:3000");
setInterval(() => {
    testClient.update();
}, 1000);

const testClient2 = new TestStateClient("http://localhost:3000");