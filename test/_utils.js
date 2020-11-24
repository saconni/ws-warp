let { EventEmitter } = require('events');
let sinon = require('sinon')

function createFakeTcpSocket() {
  let tcpSocket = new EventEmitter()
  tcpSocket.pause = sinon.fake()
  tcpSocket.resume = sinon.fake()
  tcpSocket.write = sinon.fake()
  return tcpSocket
}

function createFakeWebSocket() {
  let webSocket = new EventEmitter()
  webSocket.send = sinon.fake()
  webSocket.terminate = sinon.fake()
  webSocket._socket = createFakeTcpSocket()
  return webSocket  
}

function createFakeWebSocketServer() {
  let webSocketServer = new EventEmitter()
  return webSocketServer;
}

function createFakeTcpSocketServer() {
  let tcpSocketServer = new EventEmitter()
  return tcpSocketServer;
}

function createFakeWarpCore() {
  let warpCore = {}
  warpCore.routeCallback = sinon.fake()
  warpCore.registerEndpoint = sinon.fake()
  return warpCore
}

module.exports = { 
  createFakeTcpSocket,
  createFakeTcpSocketServer,
  createFakeWebSocket, 
  createFakeWebSocketServer,
  createFakeWarpCore
}