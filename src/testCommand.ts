import { z } from "zod";
import { Server } from "socket.io";
import { StateServer } from "./Server";
import { StateClient } from "./Client";
import { CommandChannel, StateChannel } from "./utils/Channel";
import { createCommandChannel } from "./utils/createChannel";

const testChannel = createCommandChannel("test",
    z.object({
        a: z.number(),
        b: z.number()
    }),
    z.object({
        c: z.number()
    })
)

const socketIOServer = new Server(3000);
const stateServer = new StateServer(socketIOServer);
stateServer.serve(testChannel, ({a, b}) => {
    return {
        c: a + b
    }
});

// Client 1
const stateClient1 = new StateClient("http://localhost:3000");

// Client 2
const stateClient2 = new StateClient("http://localhost:3000");

// Send updates regularly from client 1
setInterval(() => {
    stateClient1.req(testChannel, {a: 1, b: 2}, [stateClient1.serverID as string]).then((response) => {
        console.log(`Client 1 received response: ${JSON.stringify(response)}`)
    }).catch((error) => {
        // console.log(`Client 1 received error: ${error}`)
    });    
}, 1000);

// Send updates regularly from client 1
setInterval(() => {
    stateClient2.req(testChannel, {a: 2, b: 3}, [stateClient1.serverID as string]).then((response) => {
        console.log(`Client 2 received response: ${JSON.stringify(response)}`)
    }).catch((error) => {
        // console.log(`Client 2 received error: ${error}`)
    });    
}, 1500);