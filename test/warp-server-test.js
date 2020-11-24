let net = require('net')
let assert = require('assert');
let WebSocket = require('ws');
let { WarpCore } = require('../warp-core')
let { WarpServer } = require('../warp-server')
let { 
  createFakeWebSocket, 
  createFakeWebSocketServer, 
  createFakeTcpSocketServer,
  createFakeWarpCore
} = require('./_utils');

suite('warp-server', () => {
  test('can handle a websocket that closes before sending any message', (done) => {
    let server = new WarpServer(null, createFakeTcpSocketServer(), null, createFakeWebSocketServer(), null)
    let webSocket = createFakeWebSocket()
    
    server.handleWebSocket(webSocket).then(() => {
      assert.ok(webSocket.terminate.calledOnce)
    }).finally(() => {
      done()
    })

    webSocket.emit('close')
  })

  test('can handle a websocket that does not send anything', (done) => {
    let server = new WarpServer(null, createFakeTcpSocketServer(), null, createFakeWebSocketServer(), {
      waitForWebSocketDataTimeout: 1
    })
    let webSocket = createFakeWebSocket()
    
    server.handleWebSocket(webSocket).then(() => {
      assert.ok(webSocket.terminate.calledOnce)
    }).finally(() => {
      done()
    })
  })

  test('can handle a HELLO message and sends back an ACK message', (done) => {
    let core = createFakeWarpCore()
    let server = new WarpServer(core, createFakeTcpSocketServer(), null, createFakeWebSocketServer(), null)
    let webSocket = createFakeWebSocket()
    
    server.handleWebSocket(webSocket).then(() => {
      assert.ok(webSocket.send.calledOnce)
      assert.ok(webSocket.send.calledWith('ACK:HELLO'))
      assert.ok(core.registerEndpoint.calledOnce)
      assert.ok(core.registerEndpoint.calledWith('42', webSocket))
    }).finally(() => {
      done()
    })

    webSocket.emit('message', 'HELLO:42')
  })

  test('can handle a websocket that sends an invalid message', (done) => {
    let server = new WarpServer(null, createFakeTcpSocketServer(), null, createFakeWebSocketServer(), null)
    let webSocket = createFakeWebSocket()
    
    server.handleWebSocket(webSocket).then(() => {
      assert.ok(webSocket.terminate.calledOnce)
    }).finally(() => {
      done()
    })

    webSocket.emit('message', 'INVALID')
  })
  
  test('can actually handle real sockets', async () => {
    let core = new WarpCore({
      createConnectionId: () => 'aConnectionId',
      requestWarpConnection: (webSocket, connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      }
    })

    let webSocketServer = new WebSocket.Server({
      port: 8080
    })

    let tcpServer = net.createServer()
    
    tcpServer.listen(8081)

    let server = new WarpServer(core, tcpServer, null, webSocketServer, {
      lookForWarpRequestFn: (data) => {
        return {
          enpointId: '42',
          forwardHeaders: true
        }
      }
    })

    let tcpSocketReceivedData = ''
    let webSocketReceivedData = ''

    //
    // connect the websocket endpoint
    // send HELLO:42
    // wait for ACK:HELLO
    //
    let endpointWebSocket = new WebSocket('ws://localhost:8080')

    endpointWebSocket.on('open', () => {
      endpointWebSocket.send('HELLO:42')
    })

    await new Promise((resolve, reject) => {
      endpointWebSocket.on('message', msg => {
        if(msg === 'ACK:HELLO') resolve()
      })
    })

    //
    // connect the tcp socket
    // send any header on connect, WarpCore will warp to '42' with forwardHeader: true
    //
    let tcpSocket = new net.Socket();

    tcpSocket.on('data', (data) => {
      tcpSocketReceivedData += data.toString('utf-8')
    })

    await new Promise((resolve, reject) => {
      tcpSocket.connect(8081, 'localhost', () => {
        tcpSocket.write('header from tcp socket')
        resolve()
      })
    })
      
    //
    // connect the websocket callback
    // send CONN:aConnectionId
    // wait for ACK:CONN
    //
    let callbackWebSocket = new WebSocket('ws://localhost:8080')

    let callbackWebSocketHandled = new Promise((resolve, reject) => {
      callbackWebSocket.on('message', message => {
        if(message === 'ACK:CONN') {
          resolve()
        }
        webSocketReceivedData += message
      })
    })

    callbackWebSocket.on('open', () => {
      callbackWebSocket.send('CONN:aConnectionId')
    })

    await callbackWebSocketHandled


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

    assert.strictEqual('ACK:CONNheader from tcp socketfrom tcp socket to web socket', webSocketReceivedData)
    assert.strictEqual('from web socket to tcp socket', tcpSocketReceivedData)
  })
})