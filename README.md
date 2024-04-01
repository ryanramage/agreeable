Agreeable
==========

Type friendly agreements between peers for rpc and forms. A Holepunch 🕳🥊 project.

Reason
------

There is still a need in p2p environments to have services. We want to make it easy to create, use, test, and share
these services. Agreeable makes spinning up a friendly p2p service easy. 

1. Create The Agreement
-----------------------

create your service agreement with an easy to follow format. Here is an example. 

file: agreement.js

```
import { z } from 'zod'
import { params } from 'agreeable'

const api = { 
  role: 'example', 
  version: '1.0.0',
  description: 'a simple example api',
  routes: {}
}
export default api 

const userId = z.string().describe('your user id')
const authToken = z.string().describe('your api key for this service')
const headers = { userId, authToken }

api.routes.addTwo = params({a: z.number(), b: z.number()})
  .returns(z.number())
  .headers(headers)

api.routes.ping = params()
api.routes.randomName = params().returns(z.string().describe('a random name'))
api.routes.wait = params({ms: z.number().describe('time in ms to return')})
api.routes.notDefined = params({name: z.string()})
api.routes.bigReturn = params({
  name: z.string().min(4).optional().describe('name of a person')
}).returns(z.object({}).passthrough())

```
We use the well established [Zod](https://zod.dev/) schema validation and type interface to describe our api routes.
We add some light syntactic sugar to allow for params, return types, and headers. Headers can be used to authorize a user, like in web services.
We wrap everything up into a an api role and version to make sure both parties know what this is for, and when things change.

2. Create The Implementation
----------------------------

The peer that is going to enact the agreement (create the implementation), will create a file that contains the code that actually runs functions.

Here is an example of what that might look like:

impl.mjs
```
const impl = {}
impl.addTwo = ({a, b}) => a + b

impl.ping = () => console.log('got pinged, null return', Date.now())
impl.randomName = () => 'bob'
impl.wait = async ({ ms }) => {
  console.log('waiting', ms, 'ms')
  await wait(ms)
  console.log('done waiting')
}
impl.bigReturn = ({ name }) => {
  return {
    name,
    description: {
      hair: 'brown',
      eyes: 'green',
      height: 'tall',
      weight: 'heavy'
    },
    hobbies: ['fishing', 'hunting', 'swimming'],
    bio: 'I am a person who does things and stuff'
  }

}

function wait (delay) { return new Promise(resolve => setTimeout(resolve, delay)) }
export default impl

```

As you can see, async functions are available, so one could do heavy processing. Everything else is pretty straightforward. 

3. Serve the agreement and implementation
-----------------------------------------

This part is pretty easy 

index.mjs
```
import b4a from 'b4a'
import DHT from 'hyperdht'
import Protomux from 'protomux'
import Channel from 'jsonrpc-mux'
import { loadAgreement, enact } from 'agreeable'

// the things that you have to provide
import implementation from './impl.mjs'
const agreement = await loadAgreement('./agreement.mjs', import.meta.url)
const validator = async (name, headers, extraInfo) => {
  // console.log(extraInfo.remotePublicKey, 'validating', headers)
  if (name === 'addTwo' && headers.userId !== 'bob') throw new Error('invalid user')
}

let seed = null
if (global.Bare) seed = Bare.argv[2]
else seed = process.argv[2]
const seedBuf =  seed ? b4a.from(seed, 'hex') : null
const dht = new DHT()
const keyPair = DHT.keyPair(seedBuf)
const connect = c => enact(new Channel(new Protomux(c)), agreement, implementation, validator)
const server = dht.createServer(connect)

await server.listen(keyPair)
console.log('listening on:', b4a.toString(keyPair.publicKey, 'hex'))

```

4. Run the server
-----------------

using bare ```bare index.mjs```

using node ```node index.mjs```

```
listening on: 9cdd38e4df5a3a88bb56eff2048021745f29fe96ab934682510384f0ab978607
```

grab the key


5. Run the agreeable UI to test it
-----------------------------------

The source code for agreeable-ui is here : https://github.com/ryanramage/agreeable-ui 

We have a swagger like ui tool that will spin up a peer and download the agreement, and give you a nice ui to test and interact with the api.

run it with the agreement ui key and the server key as a data url

```
pear run pear://qrxbzxyqup1egwjnrmp7fcikk31nekecn43xerq65iq3gjxiaury/9cdd38e4df5a3a88bb56eff2048021745f29fe96ab934682510384f0ab978607
```

or just run 

pear run pear://qrxbzxyqup1egwjnrmp7fcikk31nekecn43xerq65iq3gjxiaury

6. Use the proxy as a client to the api in code 
-----------------------------------------------

Here is an example of running both sides of the agreement over streams. It mostly shows off the clint proxy api that is easy to use. 

```
'use strict'
import Channel from 'jsonrpc-mux'
import Protomux from 'protomux'
import SecretStream from '@hyperswarm/secret-stream'

import agreement from './share/agreement.mjs'
import { enact, proxy } from 'agreeable'

const a = new Channel(new Protomux(new SecretStream(true)))
const b = new Channel(new Protomux(new SecretStream(false)))
replicate(a, b)


const impl = {}
impl.addTwo = ({a, b}) => a + b
impl.ping = () => console.log('got pinged, null return', Date.now())
impl.randomName = () => 'bob'
impl.wait = async ({ ms }) => {
  console.log('waiting', ms, 'ms')
  await wait(ms)
  console.log('done waiting')
}
const validator = async (name, headers, extraInfo) => {
  console.log(extraInfo.remotePublicKey, 'validating')
  if (name === 'addTwo' && headers.userId !== 'bob') throw new Error('invalid user')
}
enact(a, agreement, impl, validator)

const setHeaders = () => ({  userId: 'bob', authToken: 'test'})
const client = proxy(b, agreement, setHeaders)

let results = await client.addTwo({ a:4, b:2  })
console.log('got results', results)
const name = await client.randomName()
console.log('random name', name)
await client.ping()
await client.wait({ ms: 1000 })

function replicate (a, b) { a.socket.pipe(b.socket).pipe(a.socket) }
function wait (delay) { return new Promise(resolve => setTimeout(resolve, delay)) }

```

ROADMAP
===========

Here are some things or ideas that could happen in this space

 - Simplified api server. Only have to provide the interface, implementation and seed. 
 - Simple Form collection. One function form submission, which gets stored in a hypercore
 - Form reader - remotely read the form submissions
 - Load agreements from a hyperdrive remotely
 - Registry of agreements - to have service lookups 
 - Load balancer of implementation, for really compute heavy services 
 - signed executors 
 - 2 peer executor verification


