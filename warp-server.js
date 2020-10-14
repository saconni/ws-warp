
class WarpServer {
  constructor(warpCore, httpServer, webSocketServer, net, options = {}) {
    this.warpCore = warpCore,
    this.httpServer = httpServer, 
    this.webSocketServer = webSocketServer
    this.tcpServer = net.createServer(tcpSocket => this.handleTcpSocket(tcpSocket))
    this.webSocketServer.on('connection', webSocket => this.handleWebSocket(webSocket))
    this.options = {
      waitForTcpDataTimeout: 5000,
      wairForTcpWarpTimeout: 5000,
      ...options
    }
  }

  async handleTcpSocket(tcpSocket) {
    tcpSocket.on('error', err => {
      tcpSocket.destroy()
    })
    try {
      let data = this.waitForTcpSocketData(tcpSocket, this.options.waitForTcpDataTimeout)
      tcpSocket.pause()
      tcpSocket.unshift(data)
      let enpointId = null
      if(enpointId) {
        try {
          await this.warpCore.warpTcpSocket(enpointId, tcpSocket, this.options.wairForTcpWarpTimeout)
        }
        catch(err) {
          socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
        }
      }
      else {
        this.httpServer.emit('connection', tcpSocket)
        tcpSocket.resume()
      }
    }
    catch(err) {
      tcpSocket.destroy()
    }
  }

  async handleWebSocket(webSocket) {
    try {
      this.warpCore.handleWebSocket(webSocket)
    }
    catch(err) {
      webSocket.terminate()
    }
  }

  async waitForTcpSocketData(tcpSocket, timeout) {
    return new Promise((resolve, reject) => {
      let promiseHandler = data => {
        clearTimeout(timerId)
        resolve(data)
      }
      let timerId = setTimeout(() => {
        tcpSocket.removeListener('data', promiseHandler)
        reject(new Error(`Timeout while waiting for socket data`))
      }, timeout)
      tcpSocket.once('data', promiseHandler)
    })
  }
}