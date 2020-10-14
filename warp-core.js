let { EventEmitter } = require('events');
const { networkInterfaces } = require('os');
let { v4: uuidv4 } = require('uuid');

class WarpCore {
  constructor(options = {}) {
    this.createConnectionId = options.createConnectionId || uuidv4
    this.ipcBroadcast = options.ipcBroadcast || function() {}
    this.coreId = uuidv4()
    this.bus = new EventEmitter()
  }

  async handleWebSocket(webSocket, options = {}) {
    let timeout = options.timeout || 5000

    try {
      let message = await waitForWebSocketMessage(webSocket, timeout)
      var match = /^(HELLO|CONN):(.+)/.exec(message)
      if(!match) throw new Error('Invalid initial message')

      if(match[1] === 'HELLO') {
        let endpointId = match[2]
        this.registerEndpoint(endpointId, webSocket)
        webSocket.send(`ACK:HELLO`)        
      }
      else if(match[1] === 'CONN') {
        let connectionId = match[2]
        await this.handleWebSocketCallback(connectionId, webSocket, {timeout})
      }
    }
    catch (err) {
      webSocket.terminate()
    }
  }

  registerEndpoint(endpointId, webSocket) {
    let warpHandler = connectionId => {
      webSocket.send(`REQ:${connectionId}`)
    }

    this.bus.on(`warpRequest:${endpointId}`, warpHandler)

    webSocket.once('close', () => {
      this.bus.removeListener(`warpRequest:${endpointId}`, warpHandler)
    })
  }

  waitForBusEvent(event, timeout) {
    return new Promise((resolve, reject) => {
      let promiseHandler = arg => {
        clearTimeout(timerId)
        resolve(arg)
      }
      let timerId = setTimeout(() => {
        this.bus.removeListener(event, promiseHandler)
        reject(new Error(`Timeout while waiting for ${event}`))
      }, timeout)
      this.bus.once(event, promiseHandler)
    })
  }

  async warpTcpSocket(endpointId, tcpSocket, options = {}) {
    let timeout = options.timeout || 5000
    let connectionId = this.createConnectionId()

    let promiseOfCallback = this.waitForBusEvent(`warpCallback:${connectionId}`, timeout)
    this.emit(`warpRequest:${endpointId}`, connectionId)
    await promiseOfCallback

    let promiseOfWarpDone = this.waitForBusEvent(`warpDone:${connectionId}`, timeout)
    this.emit(`warpConnect:${connectionId}`, null, tcpSocket)
    await promiseOfWarpDone
  }

  async handleWebSocketCallback(connectionId, webSocket, options = {}) {
    let timeout = options.timeout || 5000
    
    let promiseOfTcpSocket = this.waitForBusEvent(`warpConnect:${connectionId}`, timeout)
    this.emit(`warpCallback:${connectionId}`)
    let tcpSocket = await promiseOfTcpSocket

    pipeWebSocketAndTcpSocket(webSocket, tcpSocket)

    this.emit(`warpDone:${connectionId}`)
  }

  emit(event, param, handle) {
    this.bus.emit(event, param || handle)
    this.ipcBroadcast(JSON.stringify({
      event,
      param,
      coreId: this.coreId}
    ), handle)
  }

  handleIpcBroadcast(message, handle) {
    let obj = JSON.parse(message)
    // ignore self messages
    if(obj.coreId === this.coreId) return
    this.bus.emit(obj.event, obj.param || handle)
  }
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

function pipeWebSocketAndTcpSocket (webSocket, tcpSocket) {
  let webSocketWriteDone = Promise.resolve()

  tcpSocket.on('data', (chunk) => {
    tcpSocket.pause()
    webSocketWriteDone = new Promise((resolve) => {
      webSocket.send(chunk, () => {
        webSocketWriteDone = Promise.resolve()
        tcpSocket.resume()
        resolve()
      })
    })
  })
  tcpSocket.on('close', () => {
    webSocketWriteDone.then(() => {
      webSocket.terminate()
    })
  })

  tcpSocketWriteDone = Promise.resolve()

  webSocket.on('message', (chunk) => {
    if (!tcpSocket.destroyed) {
      webSocket._socket.pause()
      tcpSocketWriteDone = new Promise((resolve) => {
        needDrain = tcpSocket.write(chunk, () => {
          tcpSocketWriteDone = Promise.resolve()
          webSocket._socket.resume()
          resolve()
        })
      })
    }
  })
  webSocket._socket.on('close', () => {
    webSocket.terminate()
    tcpSocketWriteDone.then(() => {
      tcpSocket.destroy()
    })
  })
}

module.exports = { WarpCore }