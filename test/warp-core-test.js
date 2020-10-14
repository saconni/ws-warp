let assert = require('assert');
let sinon = require('sinon')
let { EventEmitter } = require('events');
let WebSocket = require('ws');
let net = require('net')
let { WarpCore } = require('../warp-core')

suite('warp-core', () => {
  test('can handle a websocket that closes before sending any message', (done) => {
    let core = new WarpCore()
    let webSocket = createFakeWebSocket()
    let prom = core.handleWebSocket(webSocket)
    webSocket.emit('close')
    prom.then(() => {
      assert.ok(webSocket.terminate.calledOnce)
      done()
    })
  })

  test('can handle a websocket that does not send anything', (done) => {
    let core = new WarpCore()
    let webSocket = createFakeWebSocket()
    let prom = core.handleWebSocket(webSocket, {timeout: 1})
    prom.then(() => {
      assert.ok(webSocket.terminate.calledOnce)
      done()
    })
  })

  test('can handle a HELLO message and sends back an ACK message', (done) => {
    let core = new WarpCore()
    let webSocket = createFakeWebSocket()
    
    let prom = core.handleWebSocket(webSocket)
    webSocket.emit('message', 'HELLO:42')
    prom.then(() => {
      assert.ok(webSocket.send.calledOnce)
      assert.ok(webSocket.send.calledWith('ACK:HELLO'))
      done()
    })
  })

  test('can handle a websocket that sends an invalid message', (done) => {
    let core = new WarpCore()
    let webSocket = createFakeWebSocket()
    
    let prom = core.handleWebSocket(webSocket)
    webSocket.emit('message', 'INVALID')
    prom.then(() => {
      assert.ok(webSocket.terminate.calledOnce)
      done()
    })
  })

  test('can send a connection request to a registered endpoint', async () => {
    let core = new WarpCore({createConnectionId: () => 'aConnectionId'})
    let webSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()
    core.registerEndpoint('42', webSocket)
    await assertAsyncThrows(core.warpTcpSocket('42', tcpSocket, {timeout: 10}))
    assert.ok(webSocket.send.calledOnce)
    assert.ok(webSocket.send.calledWith('REQ:aConnectionId'))
  })

  test('can handle a connection callback after a warp request', async () => {
    let core = new WarpCore({createConnectionId: () => 'aConnectionId'})
    let endpointWebSocket = createFakeWebSocket()
    let callbackWebSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()
    core.registerEndpoint('42', endpointWebSocket)
    let promiseOfWarp =  core.warpTcpSocket('42', tcpSocket, {timeout: 10})
    await core.handleWebSocketCallback('aConnectionId', callbackWebSocket, {timeout: 10})
    await promiseOfWarp
  })

  test('can handle an unknown incomming callback', async () => {
    let core = new WarpCore()
    let callbackWebSocket = createFakeWebSocket()

    let callbackHandled = core.handleWebSocket(callbackWebSocket, {timeout: 10})
    callbackWebSocket.emit('message', 'CONN:anInvalidConnectionId')
    await callbackHandled
    assert.ok(callbackWebSocket.terminate.calledOnce)
  })

  test('can reject a connection callback if nobody wants to handle it', async () => {
    let core = new WarpCore()
    let callbackWebSocket = createFakeWebSocket()
    await assertAsyncThrows(core.handleWebSocketCallback('aConnectionId', callbackWebSocket, {timeout: 10}))
  })

  test('can pipe ASCII data between entangled tcpSocket.connect() and web sockets', async () => {
    let core = new WarpCore({createConnectionId: () => 'aConnectionId'})
    let endpointWebSocket = createFakeWebSocket()
    let callbackWebSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()

    let endpointHandled = core.handleWebSocket(endpointWebSocket, {timeout: 10})
    endpointWebSocket.emit('message', 'HELLO:42')
    await endpointHandled 

    let promiseOfWarp =  core.warpTcpSocket('42', tcpSocket, {timeout: 10})

    let callbackHandled = core.handleWebSocket(callbackWebSocket, {timeout: 10})
    callbackWebSocket.emit('message', 'CONN:aConnectionId')
    await callbackHandled

    await promiseOfWarp

    tcpSocket.emit('data', 'randomData')
    callbackWebSocket.emit('message', 'moreRandomData')
    assert.ok(callbackWebSocket.send.calledOnce)
    assert.ok(callbackWebSocket.send.calledWith('randomData'))
    assert.ok(tcpSocket.write.calledOnce)
    assert.ok(tcpSocket.write.calledWith('moreRandomData'))
  })

  test('can pipe ASCII data between different warp cores (useful for cluster mode)', async () => {
    let [tcpSocket, webSocket] = await createClusteredWarpedSockets()

    tcpSocket.emit('data', 'randomData')
    webSocket.emit('message', 'moreRandomData')
    assert.ok(webSocket.send.calledOnce)
    assert.ok(webSocket.send.calledWith('randomData'))
    assert.ok(tcpSocket.write.calledOnce)
    assert.ok(tcpSocket.write.calledWith('moreRandomData'))
  })

  test('can actually handle real sockets', async () => {
    let core = new WarpCore({createConnectionId: () => 'aConnectionId'})
    
    let webSocketServer = new WebSocket.Server({
      port: 8080
    })

    webSocketServer.on('connection', async ws => {
      await core.handleWebSocket(ws, {timeout: 10}).catch(e => err = e)
      bus.emit('websocket-handled')
    });

    let tcpServer = net.createServer(async socket => {
      await core.warpTcpSocket('42', socket, { timeout: 10 })
      bus.emit('tcpsocket-warped')
    }).on('error', err => { throw err })
    tcpServer.listen(8081)

    let bus = new EventEmitter()

    let tcpSocketReceivedData = ''
    let webSocketReceivedData = ''

    //
    // connect the endpoint
    //
    
    let webSocketHandled = waitForBusEvent(bus, 'websocket-handled', 500)

    let endpointWebSocket = new WebSocket('ws://localhost:8080')
    endpointWebSocket.on('open', () => {
      endpointWebSocket.send('HELLO:42')
    })

    await webSocketHandled

    //
    // connect the tcp socket
    //

    let tcpSocketWarped = waitForBusEvent(bus, 'tcpsocket-warped', 500)

    let tcpSocket = new net.Socket();
    tcpSocket.connect(8081, 'localhost', () => {

    })

    tcpSocket.on('data', (data) => {
      tcpSocketReceivedData += data.toString('utf-8')
    })

    //
    // connect the callback
    //

    webSocketHandled = waitForBusEvent(bus, 'websocket-handled', 500)

    let callbackWebSocket = new WebSocket('ws://localhost:8080')
    callbackWebSocket.on('open', () => {
      callbackWebSocket.send('CONN:aConnectionId')
    })
    
    callbackWebSocket.on('message', message => {
      webSocketReceivedData += message
    })

    await webSocketHandled

    await tcpSocketWarped

    //
    // exchange some data
    //

    tcpSocket.write('from tcp socket to web socket')
    callbackWebSocket.send('from web socket to tcp socket')

    await new Promise((resolve, reject) => {setTimeout(() => resolve(), 10)})

    tcpSocket.destroy()
    callbackWebSocket.terminate()
    endpointWebSocket.terminate()
    webSocketServer.close()
    tcpServer.close()

    assert.strictEqual('from tcp socket to web socket', webSocketReceivedData)
    assert.strictEqual('from web socket to tcp socket', tcpSocketReceivedData)
  })
})

function waitForBusEvent(eventBus, event, timeout) {
  return new Promise((resolve, reject) => {
    let promiseHandler = () => {
      clearTimeout(timerId)
      resolve()
    }
    let timerId = setTimeout(() => {
      eventBus.removeListener(event, promiseHandler)
      reject(new Error(`Test timeout while waiting for ${event}`))
    }, timeout)
    eventBus.once(event, promiseHandler)
  })
}

function createFakeWebSocket() {
  let webSocket = new EventEmitter()
  webSocket.send = sinon.fake()
  webSocket.terminate = sinon.fake()
  webSocket._socket = createFakeTcpSocket()
  return webSocket  
}

function createFakeTcpSocket() {
  let tcpSocket = new EventEmitter()
  tcpSocket.pause = sinon.fake()
  tcpSocket.resume = sinon.fake()
  tcpSocket.write = sinon.fake()
  return tcpSocket
}

async function createClusteredWarpedSockets() {
  let broadcast = (message, handle) => {
    coreA.handleIpcBroadcast(message, handle)
    coreB.handleIpcBroadcast(message, handle)
    coreC.handleIpcBroadcast(message, handle)
  }

  let coreA = new WarpCore({
    createConnectionId: () => 'aConnectionId',
    ipcBroadcast: broadcast
  })
  let coreB = new WarpCore({
    createConnectionId: () => 'aConnectionId',
    ipcBroadcast: broadcast
  })
  let coreC = new WarpCore({
    createConnectionId: () => 'aConnectionId',
    ipcBroadcast: broadcast
  })

  let endpointWebSocket = createFakeWebSocket()
  let callbackWebSocket = createFakeWebSocket()
  let tcpSocket = createFakeTcpSocket()
  
  let endpointHandled = coreA.handleWebSocket(endpointWebSocket, {timeout: 10})
  endpointWebSocket.emit('message', 'HELLO:42')
  await endpointHandled

  let promiseOfWarp = coreB.warpTcpSocket('42', tcpSocket, {timeout: 10})
  
  let callbackHandled = coreC.handleWebSocket(callbackWebSocket, {timeout: 10})
  callbackWebSocket.emit('message', 'CONN:aConnectionId')
  await callbackHandled

  await promiseOfWarp

  return [tcpSocket, callbackWebSocket]
}

async function assertAsyncThrows(promise) {
  let thrown = false
  try {
    await promise
  }
  catch(err) {
    thrown = true
  }
  assert.ok(thrown)
}