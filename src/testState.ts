import { z } from "zod";
import { Server } from "socket.io";
import { StateServer } from "./Server";
import { StateClient } from "./Client";
import { StateChannel } from "./utils/Channel";
import { createCommandChannel, createStateChannel } from "./utils/createChannel";

const stateChannel = createStateChannel("test",
    z.object({
        a: z.string(),
        b: z.number()
    })
)

const socketIOServer = new Server(3000);
const stateServer = new StateServer(socketIOServer);

stateServer.sub(stateChannel, (state) => {
    console.log(`Server received state: ${JSON.stringify(state)}`)
});

// Client 1
const stateClient1 = new StateClient("http://localhost:3000");
stateClient1.sub(stateChannel, (state) => {
    console.log(`Client 1 received state: ${JSON.stringify(state)}`)
});

// Client 2
const stateClient2 = new StateClient("http://localhost:3000");
stateClient2.sub(stateChannel, (state) => {
    console.log(`Client 2 received state: ${JSON.stringify(state)}`)
});

// Client 3
const stateClient3 = new StateClient("http://localhost:3000");
stateClient3.sub(stateChannel, (state) => {
    console.log(`Client 3 received state: ${JSON.stringify(state)}`)
});

// Send updates regularly from client 1
setInterval(() => {
    stateClient1.pub(stateChannel, {
        a: "test",
        b: Math.random()
    });
}, 1000);