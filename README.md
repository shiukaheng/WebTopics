# ⚡️ webtopics

Real-time topics and services for web apps using Socket.io and Zod inspired by ROS.
Meant for use in low-latency interactive applications on local networks.
## Features
### Typed and validated topics and services via Zod
  ```typescript
  const SensorTopic = createTopic("sensor", z.object({
    "temperature": z.number(),
    "humidity": z.number()
  }))
  client.pub(SensorTopic, {temperature: 20, humidity: "50%"}) // Error: Expected number, received string
  ```
### Collaborative topics
  ```typescript
  client1.pub(channel, {a: "1"})
  client2.pub(channel, {b: "2"})
  client3.sub(channel, (value) => {
    console.log(value) // {a: "1", b: "2"}
  })
  ```
### Async service calls
  ```typescript
  const AdditionService = createService("add", 
    // Request schema
    z.object({
      "a": z.number(),
      "b": z.number()
    }), 
    // Response schema
    z.number()
  )
  ...

  // Call service
  const result = await client.req(AdditionService, {a: 1, b: 2}, someClientID) // Promise<number>
  ```
### Packagable channels for easy sharing between client and server
  ```typescript
  export const AdditionService = createService("add", 
    z.object({
      "a": z.number(),
      "b": z.number()
    }), 
    z.number()
  )

  export const SensorTopic = createTopic("sensor", z.object({
    "temperature": z.number(),
    "humidity": z.number()
  }))
  ...

  // Client and server can share the same channels from an external package
  import {AdditionService, SensorTopic} from "channels"
  ```

# To do
- [ ] Different namespaces for topics and services
- [ ] Client listing via meta topic
- [ ] Support for service calls with multiple destinations

# API
## TopicServer
### `constructor(server: Server, selfSubscribed: boolean = true)`
Creates a server instance with the given Socket.io server. If `selfSubscribed` is true, the server will subscribe to its own topic updates.
## TopicClient
### `constructor(serverURL: string, selfSubscribed: boolean = true)`
Creates a client instance with the given Socket.io server URL. `selfSubscribed` behaves the same as in `TopicServer`.
## Shared methods between server and client
Creates a topic description with the given name and schema.
### `pub<T extends JSONValue>(channel: TopicChannel<T>, topic: T, source?: string,): void`
Publishes a value to the given topic.
### `sub<T extends JSONValue>(channel: TopicChannel<T>, handler?: (topic: T) => void): void`
Subscribes to the given topic.
### `req<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, serviceData: T, dest: string, timeout: number=10000): Promise<U>`
Calls a service with the given data and returns a promise that resolves to the service response.
### `srv<T extends JSONValue, U extends JSONValue>(channel: ServiceChannel<T, U>, handler?: (topic: T) => U): void`
Registers a service handler for the given service.
## Utility functions for creating topics and services
### `createTopic<T extends JSONValue>(name: string, schema: z.ZodSchema<T>): TopicChannel<T>`
Creates a topic description with the given name and schema.
### `createChannel<T extends JSONValue, R extends JSONValue>(name: string, requestSchema: z.ZodSchema<T>, responseSchema: z.ZodSchema<R>): ServiceChannel<T, R>`
Creates a service description with the given name and request/response schemas.