let assert = require('assert');
let sinon = require('sinon')
let { EventEmitter } = require('events');
let WebSocket = require('ws');
let net = require('net')
let { WarpCore } = require('../warp-core')
let { createFakeWebSocket, createFakeTcpSocket } = require('./_utils')

suite('warp-core', () => {
  test('can send a connection request to a registered endpoint', async () => {
    let core = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let webSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()
    core.registerEndpoint('42', webSocket)
    await assertAsyncThrows(core.warpTcpSocket('42', null, tcpSocket, {timeout: 10}))
    assert.ok(webSocket.send.calledOnce)
    assert.ok(webSocket.send.calledWith('REQ:aConnectionId'))
  })

  test('can handle a connection callback after a warp request', async () => {
    let core = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let endpointWebSocket = createFakeWebSocket()
    let callbackWebSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()
    core.registerEndpoint('42', endpointWebSocket)
    let promiseOfWarp =  core.warpTcpSocket('42', null, tcpSocket, {timeout: 10})
    await core.routeCallback('aConnectionId', callbackWebSocket, {timeout: 10})
    await promiseOfWarp
  })

  test('can handle an unknown incomming callback', async () => {
    let core = new WarpCore({
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let callbackWebSocket = createFakeWebSocket()
    await assertAsyncThrows(core.routeCallback('anInvalidConnectionId', callbackWebSocket, {timeout: 10}))
  })

  test('can reject a connection callback if nobody wants to handle it', async () => {
    let core = new WarpCore({
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let callbackWebSocket = createFakeWebSocket()
    await assertAsyncThrows(core.routeCallback('aConnectionId', callbackWebSocket, {timeout: 10}))
  })

  test('can pipe ASCII data between entangled tcpSocket.connect() and web sockets', async () => {
    let core = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let endpointWebSocket = createFakeWebSocket()
    let callbackWebSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()

    await core.registerEndpoint(42, endpointWebSocket)

    let promiseOfWarp =  core.warpTcpSocket('42', null, tcpSocket, {timeout: 10})

    await core.routeCallback('aConnectionId', callbackWebSocket)

    await promiseOfWarp

    tcpSocket.emit('data', 'randomData')
    callbackWebSocket.emit('message', 'moreRandomData')
    assert.ok(callbackWebSocket.send.calledOnce)
    assert.ok(callbackWebSocket.send.calledWith('randomData'))
    assert.ok(tcpSocket.write.calledOnce)
    assert.ok(tcpSocket.write.calledWith('moreRandomData'))
  })

  test('can pipe ASCII data between different warp cores (useful for cluster mode)', async () => {
    let broadcast = (message, handle) => {
      coreA.handleIpcBroadcast(message, handle)
      coreB.handleIpcBroadcast(message, handle)
      coreC.handleIpcBroadcast(message, handle)
    }
  
    let coreA = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      ipcBroadcast: broadcast,
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let coreB = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      ipcBroadcast: broadcast,
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
    let coreC = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      ipcBroadcast: broadcast,
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })
  
    let endpointWebSocket = createFakeWebSocket()
    let callbackWebSocket = createFakeWebSocket()
    let tcpSocket = createFakeTcpSocket()
    
    await coreA.registerEndpoint(42, endpointWebSocket)
  
    let promiseOfWarp = coreB.warpTcpSocket('42', null, tcpSocket, {timeout: 10})
    
    await coreC.routeCallback('aConnectionId', callbackWebSocket, {timeout: 10})
  
    await promiseOfWarp

    tcpSocket.emit('data', 'randomData')
    callbackWebSocket.emit('message', 'moreRandomData')
    assert.ok(callbackWebSocket.send.calledOnce)
    assert.ok(callbackWebSocket.send.calledWith('randomData'))
    assert.ok(tcpSocket.write.calledOnce)
    assert.ok(tcpSocket.write.calledWith('moreRandomData'))
  })

  /*

  */
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

  let promiseOfWarp = coreB.warpTcpSocket('42', null, tcpSocket, {timeout: 10})
  
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