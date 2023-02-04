import { z } from "zod";
import { Server } from "socket.io";
import { StateServer } from "./Server";
import { StateClient } from "./Client";
import { io } from "socket.io-client";

const testSchema = z.object({
    a: z.string(),
    b: z.number(),
});

const testChannel = {
    name: "test",
    schema: testSchema
}

const socketIOServer = new Server(3000);
const stateServer = new StateServer(socketIOServer);

stateServer.addStateChannel(testChannel, (state) => {
    console.log(`Server received state: ${JSON.stringify(state)}`)
});

// Client 1
const stateClient1 = new StateClient("http://localhost:3000");
stateClient1.addStateChannel(testChannel, (state) => {
    console.log(`Client 1 received state: ${JSON.stringify(state)}`)
});

// Send updates regularly from client 1
setInterval(() => {
    stateClient1.updateState(testChannel, {
        a: "test",
        b: Math.random()
    });
}, 1000);