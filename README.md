# 🪞state-share.ts
Magically synchronize typed objects through Socket.IO and Zod
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
const stateServer = new StateServer(socketServer, [sensorChannel])
```
### 3️⃣ Use on client to update state
```typescript
// Create client
const socketClient = io("http://localhost:3000");
const stateClient = new StateClient(socketClient, [sensorChannel])

// Update state
onNewSensorValue((value: SensorValue) => {
  stateClient.updateState(sensorChannel, value)
})
```
### 4️⃣ Use on client to subscribe to state changes
```typescript
// Subscribe to state changes
stateClient.subscribeToState(sensorChannel, (value: SensorValue) => {
  console.log(value)
})
```
# Features
- Multiple clients can publish and subscribe to the same state
- Only delta updates are sent over the wire
