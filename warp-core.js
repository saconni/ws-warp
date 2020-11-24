let { EventEmitter } = require('events');
let { v4: uuidv4 } = require('uuid');

class WarpCore {
  constructor(options = {}) {
    this.ipcBroadcast = options.ipcBroadcast || function() {}
    this.coreId = uuidv4()
    this.bus = new EventEmitter()
  }

  registerEndpoint(endpointId, webSocket, sendWarpRequest) {
    let warpRequestHandler = (connectionId, warpRequest) => {
      sendWarpRequest(connectionId, warpRequest)
    }

    this.bus.on(`warpRequest:${endpointId}`, warpRequestHandler)

    webSocket.once('close', () => {
      this.bus.removeListener(`warpRequest:${endpointId}`, warpRequestHandler)
    })
  }

  waitForBusEvent(event, timeout) {
    return new Promise((resolve, reject) => {
      let promiseHandler = (...args) => {
        clearTimeout(timerId)
        resolve(args)
      }
      let timerId = setTimeout(() => {
        this.bus.removeListener(event, promiseHandler)
        reject(new Error(`Timeout while waiting for ${event}`))
      }, timeout)
      this.bus.once(event, promiseHandler)
    })
  }

  async warpTcpSocket(tcpSocket, connectionId, endpointId, warpRequest, options = {}) {
    let timeout = options.timeout || 5000

    let promiseOfCallback = this.waitForBusEvent(`warpCallback:${connectionId}`, timeout)
    this.emit(`warpRequest:${endpointId}`, null, connectionId, warpRequest)
    await promiseOfCallback

    let promiseOfWarpDone = this.waitForBusEvent(`warpDone:${connectionId}`, timeout)
    this.emit(`warpConnect:${connectionId}`, tcpSocket)
    await promiseOfWarpDone
  }

  async routeCallback(connectionId, webSocket, options = {}) {
    let timeout = options.timeout || 5000
    
    let promiseOfTcpSocket = this.waitForBusEvent(`warpConnect:${connectionId}`, timeout)
    this.emit(`warpCallback:${connectionId}`)
    let [tcpSocket] = await promiseOfTcpSocket

    pipeWebSocketAndTcpSocket(webSocket, tcpSocket)

    this.emit(`warpDone:${connectionId}`)
  }

  emit(event, handle, ...args) {
    this.bus.emit.apply(this.bus, [event, ...args, handle])
    this.ipcBroadcast(JSON.stringify({
      event,
      args,
      coreId: this.coreId
    }), handle)
  }

  handleIpcBroadcast(message, handle) {
    let obj = JSON.parse(message)
    // ignore self messages
    if(obj.coreId === this.coreId) return
    this.bus.emit.apply(this.bus, [obj.event, ...obj.args, handle])
  }
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