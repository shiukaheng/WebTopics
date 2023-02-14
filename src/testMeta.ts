// import { z } from "zod";
// import { Server } from "socket.io";
// import { TopicServer } from "./Server";
// import { TopicClient } from "./Client";
// import { createService, createTopic } from "./utils/createChannel";
// import { serverMetaChannel } from "./metaChannels";
// import { io } from "socket.io-client";

// // Create a server
// const server = new TopicServer(new Server(3002));

// // Create a test service
// const testService = createService("testService",
//     z.object({
//         test: z.string(),
//     }),
//     z.object({
//         test: z.string(),
//     })
// );


// server.sub(serverMetaChannel, (data)=>{
//     console.log("🎊 Server meta:", data);
// })

// // Make the 3 clients connect 1 by 1 with a 1 second delay
// setTimeout(()=>{
//     const client1 = new TopicClient(io("http://localhost:3002"));
//     client1.sub(serverMetaChannel, (data)=>{
//         console.log("🎊 Client 1 server meta:", data);
//     })
//     client1.srv(testService, (data)=>{
//         console.log("🎊 Client 1 test service:", data);
//         return {
//             test: "Client 1 response"
//         }
//     })
// }
// , 1000);