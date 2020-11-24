let { v4: uuidv4 } = require('uuid');
class WarpServer {
  constructor(warpCore, tcpServer, httpServer, wsServer, options = {}) {
    this.warpCore = warpCore,
    this.httpServer = httpServer, 
    this.webSocketServer = wsServer
    this.tcpSocketServer = tcpServer
    this.tcpSocketServer.on('connection', tcpSocket => this.handleTcpSocket(tcpSocket))
    this.webSocketServer.on('connection', webSocket => this.handleWebSocket(webSocket))
    this.createConnectionId = options.createConnectionId || uuidv4

    this.options = {
      waitForTcpDataTimeout: 5000,
      waitForTcpWarpTimeout: 5000,
      waitForWebSocketDataTimeout: 5000,
      waitForRouteCallbackTimeout: 5000,
      lookForWarpRequestFn: (data) => null,
      ...options
    }
  }

  async handleWebSocketMessage(webSocket, message) {
    var match = /^(HELLO|CONN):(.+)/.exec(message)
    if(!match) throw new Error('Invalid initial message')

    if(match[1] === 'HELLO') {
      let endpointId = match[2]
      await this.warpCore.registerEndpoint(endpointId, webSocket, (connectionId, warpRequest) => {
        webSocket.send(`REQ:${connectionId}`)
      })
      webSocket.send(`ACK:HELLO`)
    }
    else if(match[1] === 'CONN') {
      let connectionId = match[2]
      await this.warpCore.routeCallback(connectionId, webSocket, {timeout: this.options.waitForRouteCallbackTimeout})
      webSocket.send(`ACK:CONN`)
    }
  }

  async handleTcpSocket(tcpSocket) {
    tcpSocket.on('error', err => {
      tcpSocket.destroy()
    })
    try {
      let data = await waitForTcpSocketData(tcpSocket, this.options.waitForTcpDataTimeout)
      tcpSocket.pause()
      let warpRequest = this.options.lookForWarpRequestFn(data)
      if(warpRequest) {
        try {
          if(warpRequest.forwardHeaders) {
            tcpSocket.unshift(data)
          }
          let { endpointId } = warpRequest
          await this.warpCore.warpTcpSocket(tcpSocket, this.createConnectionId(), endpointId, warpRequest, this.options.waitForTcpWarpTimeout)
          tcpSocket.resume()
        }
        catch(err) {
          tcpSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        }
      }
      else {
        tcpSocket.unshift(data)
        this.httpServer.emit('connection', tcpSocket)
        tcpSocket.resume()
      }
    }
    catch(err) {
      //console.log(err)
      tcpSocket.destroy()
    }
  }

  async handleWebSocket(webSocket) {
    try {
      let message = await waitForWebSocketMessage(webSocket, this.options.waitForWebSocketDataTimeout)
      await this.handleWebSocketMessage(webSocket, message)
    }
    catch (err) {
      //console.log(err)
      webSocket.terminate()
    }
  }
}

async function waitForTcpSocketData(tcpSocket, timeout) {
  return new Promise((resolve, reject) => {
    let onData = data => {
      clearTimeout(timerId)
      resolve(data)
    }
    let timerId = setTimeout(() => {
      tcpSocket.removeListener('data', onData)
      reject(new Error(`Timeout while waiting for socket data`))
    }, timeout)
    tcpSocket.once('data', onData)
  })
}

function waitForWebSocketMessage(webSocket, milliseconds) {
  let timerId = 0
  return Promise.race([
    new Promise((resolve, reject) => {
      timerId = setTimeout(() => {
        reject(new Error('Timeout while waiting for websocket message'))
      }, milliseconds)
    }),
    new Promise((resolve, reject) => {
      webSocket.once('close', () => {
        clearTimeout(timerId)
        reject(new Error('WebSocket closed while waiting for message'))
      })
    }),
    new Promise((resolve, reject) => {
      webSocket.once('message', msg => {
        clearTimeout(timerId)
        resolve(msg)
      })
    })
  ])
}

module.exports = { WarpServer }