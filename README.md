# ⚡️ state-share
Tiny pub/sub library to share and collaboratively edit typed objects through Socket.IO and Zod. Meant to be used on local networks.
### Features / behaviour
- Fully bi-directional
- Publishes partial changes
  - Allows for multiple clients publishing on same object without knowing 
## Usage
### 1️⃣ Create channel definitions
```typescript
import { z } from "zod";

export const sensorValueSchema = z.object({
  "temperature": z.number(),
  "humidity": z.number()
})
export type SensorValue = z.infer<typeof sensorValueSchema>
export const sensorChannel: Channel = {
  name: "sensor",
  schema: sensorValueSchema
}
```
### 2️⃣ Declare channels on server
```typescript
import { Server } from "socket.io";
import { StateServer } from "state-share";
import { sensorChannel } from "./channelDefs"

// Create server
const socketServer = new Server(3000);
const server = new StateServer(socketServer, [sensorChannel])
```
### 3️⃣ Use on client to update state
```typescript
// Create client
const socketClient = io("http://localhost:3000");
const client = new StateClient(socketClient, [sensorChannel])

// Update state
onNewSensorValue((value) => {
  client.pub(sensorChannel, value)
})
```
### 4️⃣ Use on client to subscribe to state changes
```typescript
// Subscribe to state changes
stateClient.sub(sensorChannel, (value) => {
  console.log(value)
})
```
# Features
- Multiple clients can publish and subscribe to the same state
- Only delta updates are sent over the wire
