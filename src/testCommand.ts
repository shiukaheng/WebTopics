import { z } from "zod";
import { Server } from "socket.io";
import { StateServer } from "./Server";
import { StateClient } from "./Client";
import { CommandChannel, StateChannel } from "./utils/Channel";

const testSchema = z.object({
    a: z.number(),
    b: z.number()
});

const testResponseSchema = z.object({
    c: z.number()
});

const testChannel: CommandChannel<z.infer<typeof testSchema>, z.infer<typeof testResponseSchema>> = {
    mode: "command",
    name: "test",
    schema: testSchema,
    responseSchema: testResponseSchema
}

const socketIOServer = new Server(3000);
const stateServer = new StateServer(socketIOServer);

stateServer.serve(testChannel, ({a, b}) => {
    return {
        c: a + b
    }
});

// Client 1
const stateClient1 = new StateClient("http://localhost:3000");

// Send updates regularly from client 1
setInterval(() => {
    stateClient1.req(testChannel, {a: 1, b: 2}, [stateClient1.serverID as string]).then((response) => {
        console.log(`Client 1 received response: ${JSON.stringify(response)}`)
    }).catch((error) => {
        // console.log(`Client 1 received error: ${error}`)
    });    
}, 1000);