/*
File: file-server.js
Description: HyperReload file server.
Author: Mikael Kindborg

License:

Copyright (c) 2015 Evothings AB

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/*********************************/
/***	 Imported modules	   ***/
/*********************************/

var OS = require('os')
var FS = require('fs')
var PATH = require('path')
var SOCKETIO_CLIENT = require('socket.io-client')
var FILEUTIL = require('./file-util.js')
var LOADER = require('./file-loader.js')
var LOGGER = require('./log.js')
var SETTINGS = require('../settings/settings.js')
var UUID = require('./uuid.js')
var EVENTS = require('./system-events.js')

/*********************************/
/***	 Module variables	   ***/
/*********************************/

// Workbench version code should be incremented on each new release.
// The version code can be used by the server to display info.
var mWorkbenchVersionCode = 6

// Version of the server message protocol implemented on top of socket.io.
// Increment when the protocol has changed.
var mProtocolVersion = 5

var mIsConnected = false
var mSessionID = null
var mRemoteServerURL = ''
var mSocket = null
var mAppFile = null
var mAppID = null
var mMessageCallback = null
var mClientInfoCallback = null
var mReloadCallback = null
var mRequestConnectKeyCallback = null
var mCheckIfModifiedSince = false
var mHeartbeatTimer = undefined
var mDeviceInfo = {}
var mHeartbeatInterval = 20000
var mCLientInfo = undefined

// The current base directory. Must NOT end with a slash.
var mBasePaths = {}

/*********************************/
/***	 Server functions	   ***/
/*********************************/

/**
 * External.
 */
exports.connectToRemoteServer = function()
{
	LOGGER.log('[file-server.js] Connecting to remote server')

	// Message handler table.
	var messageHandlers =
	{
		// Messages from the server to the Workbench.
		'workbench.set-session-id': onMessageWorkbenchSetSessionID,
		'workbench.set-connect-key': onMessageWorkbenchSetConnectKey,
		'workbench.client-info': onMessageWorkbenchClientInfo,
		'client.instrumentation': onMessageWorkbenchClientInstrumentation,
		'workbench.get-resource': onMessageWorkbenchGetResource,
		'workbench.log': onMessageWorkbenchLog,
		'workbench.javascript-result': onMessageWorkbenchJavaScriptResult,
		'workbench.user-message': onMessageWorkbenchUserMessage,
		'workbench.user-login': onMessageWorkbenchUserLogin,
		'workbench.user-logout': onMessageWorkbenchUserLogout
	}

	LOGGER.log('[file-server.js] connecting to server: ' + mRemoteServerURL)

	// Create socket.io instance.
	var socket = SOCKETIO_CLIENT(
		mRemoteServerURL,
		{ 'force new connection': true })

	// Save global reference to socket.io object.
	mSocket = socket

	// Connect function.
	socket.on('connect', function()
	{
		LOGGER.log('[file-server.js] Connected to server')
		mIsConnected = true
		EVENTS.publish(EVENTS.CONNECT, { event: 'connected' })
		//exports.requestConnectKey()
		mSessionID = SETTINGS.getSessionID()

		LOGGER.log('[file-server.js] workbench.connected session: ' + mSessionID)

		var info =
		{
			arch: OS.arch(),
			platform: OS.platform(),
			osrelease: OS.release(),
			ostype: OS.type()
		}
		var uuid = SETTINGS.getEvoGUID()
		//LOGGER.log('[file-server.js] ------ uuid = '+uuid)
		mDeviceInfo = info
		sendMessageToServer(mSocket, 'workbench.connected', { sessionID: mSessionID, uuid: uuid, info: info })
		mHeartbeatTimer = setInterval(heartbeat, mHeartbeatInterval)
		heartbeat()
	})

	socket.on('error', function(error)
	{
		LOGGER.log('[file-server.js] socket error: ' + error)
	})

	socket.on('disconnect', function()
	{
		mIsConnected = false
		EVENTS.publish(EVENTS.DISCONNECT, {event: 'disconnected' })
		clearInterval(mHeartbeatTimer)
	})

	socket.on('hyper-workbench-message', function(message)
	{
		//console.log('message = '+message.name)

		var handler = messageHandlers[message.name]
		if (handler)
		{
			handler(socket, message)
		}
	})
}

function getBasePathForAppID(appID)
{
	return mBasePaths[appID]
}

function heartbeat()
{
	var uuid = SETTINGS.getEvoGUID()
	sendMessageToServer(mSocket, 'workbench.heartbeat', { sessionID: mSessionID, uuid: uuid, info: mDeviceInfo })
}

function onMessageWorkbenchUserLogin(socket, message)
{
	if(message.data && message.data.user)
	{
		EVENTS.publish(EVENTS.LOGIN, message.data.user)
	}
}

function onMessageWorkbenchUserLogout(socket, message)
{
	EVENTS.publish(EVENTS.LOGOUT, {event: 'logout'})
}

function sendMessageToServer(_socket, name, data)
{
	var socket = _socket || mSocket
	var uuid = SETTINGS.getEvoGUID()
	//console.log('[file-server.js] --------------')
	//console.log('[file-server.js] sendMessageToServer: ' + JSON.stringify(data))
	//console.log('[file-server.js] --------------')
	//console.log('[file-server.js] sendMessageToServer -- uuid = '+uuid)
	socket.emit('hyper-workbench-message', {
		protocolVersion: mProtocolVersion,
		workbenchVersionCode: mWorkbenchVersionCode,
		name: name,
		sessionID: mSessionID,
		UUID: uuid,
		data: data })
}

function onMessageWorkbenchSetSessionID(socket, message)
{
	LOGGER.log('[file-server.js] onMessageWorkbenchSetSessionID: ' + message.data.sessionID)

	// Set/display session id if we got it.
	if (message.data.sessionID)
	{
		// Save the session id.
		mSessionID = message.data.sessionID

		// Save session id in settings.
		SETTINGS.setSessionID(mSessionID)

		// Send event width session id.
		// TODO: Who is listening to this? No one it seems.
		EVENTS.publish(EVENTS.SETSESSIONID, mSessionID)
	}

	// Display user message if we got one.
	if (message.userMessage)
	{
		EVENTS.publish(EVENTS.USERMESSAGE, message.userMessage)
	}
}

function onMessageWorkbenchSetConnectKey(socket, message)
{
	//console.dir(message)
	mRequestConnectKeyCallback && mRequestConnectKeyCallback(message)
}

function onMessageWorkbenchClientInfo(socket, message)
{
	//console.log('[file-server.js] got client info')
	//console.dir(message)

	// Notify UI about clients.
	EVENTS.publish(EVENTS.VIEWERSUPDATED, message.data)
	mCLientInfo = message.data

	mClientInfoCallback && mClientInfoCallback(message)
}

function onMessageWorkbenchClientInstrumentation(socket, message)
{
	// Notify UI about clients.
	//LOGGER.log('[file-server.js] ******** got client instrumentation')
	//console.dir(message)

	EVENTS.publish(EVENTS.VIEWERSINSTRUMENTATION, message.data)
}

function onMessageWorkbenchGetResource(socket, message)
{
	var ifModifiedSince =
		mCheckIfModifiedSince
			? message.data.ifModifiedSince
			: null

	var response = serveResource(
		message.data.platform,
		message.data.path,
		message.data.appID,
		ifModifiedSince)

	sendMessageToServer(socket, 'workbench.resource-response',
		{
			id: message.data.id,
			sessionID: mSessionID,
			appID: mAppID,
			response: response
		})
}

function onMessageWorkbenchLog(socket, message)
{
	// Pass message to Tools window.
	mMessageCallback && mMessageCallback(
		{ message: 'hyper.log', logMessage: message.data.message })
}

function onMessageWorkbenchJavaScriptResult(socket, message)
{
	var data = message.data.result

	// Functions cause a cloning error, as a fix just show the type.
	if (typeof data == 'function')
	{
		data = typeof data
	}

	// Pass message to Tools window.
	mMessageCallback && mMessageCallback(
		{ message: 'hyper.result', result: data })
}

function onMessageWorkbenchUserMessage(socket, message)
{
	// Display message if we gone one.
	if (message.userMessage)
	{
		// Pass the message to the callback function,
		// this displays the message in the UI.
		EVENTS.publish(EVENTS.USERMESSAGE, message.userMessage)
	}
}

/**
 * External.
 */
exports.isConnected = function()
{
	return mIsConnected
}

/**
 * External.
 */
exports.requestConnectKey = function()
{
	// On first call mSessionID will be null, if server goes down
	// and we connect again we will pass our session id so the server
	// can restore our session.
	LOGGER.log('[file-server.js] requesting connect key from server')
	sendMessageToServer(mSocket, 'workbench.request-connect-key', { sessionID: mSessionID })
}

/**
 * External.
 */
exports.sendDisconnectAllViewersToServer = function()
{
	sendMessageToServer(mSocket, 'workbench.disconnect-viewers', { sessionID: mSessionID })
}

/**
 * External.
 */
exports.disconnectFromRemoteServer = function()
{
	LOGGER.log('[file-server.js] Disconnecting from remote server')

	if (mSocket)
	{
		mSocket.close()
	}
}

/**
 * Internal.
 */
function serveUsingResponse200()
{
	mCheckIfModifiedSince = false
}

/**
 * Internal.
 */
function serveUsingResponse304()
{
	mCheckIfModifiedSince = true
}

/**
 * Internal.
 */
function serveResource(platform, path, appID, ifModifiedSince)
{
	//console.log('[file-server.js] serveResource: ' + path)
	var basePath = getBasePathForAppID(appID)
	if (!path || path == '/')
	{
		// TODO: Serve something else? A default page?
		// Handle this case in the server?
		LOADER.createResponse404(path)
	}
	else if (SETTINGS.getServeCordovaJsFiles() &&
		(path == '/cordova.js' ||
		path == '/cordova_plugins.js' ||
		path.indexOf('/plugins/') == 0))
	{
		return serveCordovaFile(platform, path, ifModifiedSince)
	}
	else if (basePath)
	{
		return LOADER.response(
			PATH.join(basePath, path),
			ifModifiedSince)
	}
	else
	{
		return LOADER.createResponse404(path)
	}
}

/**
 * Internal.
 *
 * Returns null if file is not found.
 */
function serveFileOrNull(path)
{
	var response = LOADER.response(path)
	if (200 == response.resultCode)
	{
		return response
	}
	else
	{
		return null
	}
}

/**
 * Internal.
 *
 * Serve Cordova JavaScript file for the platform making the request.
 */
function serveCordovaFile(platform, path, appID)
{
	// Two methods are used to find cordova files for the
	// platform making the request.

	// Method 1:
	// If we are inside a cordova project, we use the
	// files in that project.
	// Folder structure:
	//	 www <-- mBasePath (root of running app)
	//	   index.html
	//	 platforms
	//	   android
	//		 assets
	//		   www
	//			 cordova.js
	//			 cordova_plugins.js
	//			 plugins
	//	   ios
	//		 www
	//		   cordova.js
	//		   cordova_plugins.js
	//		   plugins
	//
	// Set path to Cordova files in current project.
	// Note that mBasePath ends with path separator.

	var basePath = getBasePathForAppID(appID)
	var androidCordovaAppPath =
		basePath +
		'../platforms/android/assets/' +
		'www' + path
	var iosCordovaAppPath =
		basePath +
		'../platforms/ios/' +
		'www' + path
	var wpCordovaAppPath =
		basePath +
		'../platforms/wp8/' +
		'www' + path

	// Method 2:
	// Paths to Cordova files in the HyperReload library.
	// This is used if the application is not a Cordova project.
	var androidCordovaLibPath = './hyper/libs-cordova/android' + path
	var iosCordovaLibPath = './hyper/libs-cordova/ios' + path
	var wpCordovaLibPath = './hyper/libs-cordova/wp' + path

	// Get the file, first try the path for a Cordova project, next
	// get the file from the HyperReload Cordova library folder.
	var cordovaJsFile = null
	if ('android' == platform)
	{
		cordovaJsFile =
			serveFileOrNull(androidCordovaAppPath) ||
			serveFileOrNull(androidCordovaLibPath)
	}
	else if ('ios' == platform)
	{
		cordovaJsFile =
			serveFileOrNull(iosCordovaAppPath) ||
			serveFileOrNull(iosCordovaLibPath)
	}
	else if ('wp' == platform)
	{
		cordovaJsFile =
			serveFileOrNull(wpCordovaAppPath) ||
			serveFileOrNull(wpCordovaLibPath)
	}

	return cordovaJsFile || LOADER.createResponse404(path)
}

/**
 * External.
 */
exports.setAppPath = function(appPath, appID)
{
	mBasePaths[appID] = PATH.normalize(appPath.replace(new RegExp('\\' + PATH.sep, 'g'), '/'))
}

/**
 * External.
 */
exports.setAppFileName = function(fileName)
{
	mAppFile = PATH.normalize(fileName.replace(new RegExp('\\' + PATH.sep, 'g'), '/'))
}

/**
 * External.
 */
exports.setAppID = function(id)
{
	mAppID = id
}

/**
 * External.
 *
 * Return the name of the main HTML file of the application.
 */
exports.getAppFileName = function()
{
	return mAppFile
}

/**
 * External.
 */
/*
exports.getAppPath = function()
{
	return PATH.join(mBasePath, mAppFile)
}
*/
/**
 * External.
 */
/*
exports.getBasePath = function()
{
	return mBasePath
}
*/

/**
 * External.
 */
exports.getAppServerURL = function()
{
	return mRemoteServerURL + '/hyper/' + mSessionID + getAppURL()
}

/**
 * Internal.
 */
function getAppURL()
{
	// mAppId  from evothings.json
	return '/' + mAppID + '/' + mAppFile
}

/**
 * External.
 */
exports.getUserKey = function()
{
	return mUserKey
}

exports.getClientInfo = function()
{
	return mCLientInfo
}

/**
 * External.
 *
 * Reloads the main HTML file of the current app.
 */
exports.runApp = function(appID)
{
	//serveUsingResponse200()
	serveUsingResponse304()
	console.log('@@@ [file-server.js] run app: ' + getAppURL())
	sendMessageToServer(mSocket, 'workbench.run',
		{
			sessionID: mSessionID,
			appID: appID, // from evothings.json
			appName: hyper.UI.getProjectNameFromFile(exports.getAppPath()), // title tag, not critical
			url: getAppURL()
		})
}

/**
 * External.
 *
 * Reloads the currently visible page of the browser.
 */
exports.reloadApp = function(appID)
{
	serveUsingResponse304()
	sendMessageToServer(mSocket, 'workbench.reload',
		{
			sessionID: mSessionID,
			appID: appID,
			appName: hyper.UI.getProjectNameFromFile(exports.getAppPath())
		})
	mReloadCallback && mReloadCallback()
}

/**
 * External.
 */
exports.evalJS = function(code, client)
{
	sendMessageToServer(mSocket, 'workbench.eval',
		{
			sessionID: mSessionID,
			code: code,
			clientUUID: client ? client.UUID: ''
		})
}

/**
 * External.
 *
 * Callback form: fun(object)
 */
exports.setMessageCallbackFun = function(fun)
{
	mMessageCallback = fun
}

/**
 * External.
 *
 * Callback form: fun(message)
 */
exports.setClientInfoCallbackFun = function(fun)
{
	mClientInfoCallback = fun
}

/**
 * External.
 *
 * Callback form: fun()
 */
exports.setReloadCallbackFun = function(fun)
{
	mReloadCallback = fun
}

/**
 * External.
 *
 * Callback form: fun(message)
 */
exports.setRequestConnectKeyCallbackFun = function(fun)
{
	mRequestConnectKeyCallback = fun
}

/**
 * External.
 */
exports.setRemoteServerURL = function(url)
{
	mRemoteServerURL = url
}

/**
 * External.
 */
exports.getSessionID = function()
{
	return mSessionID
}

exports.sendMessageToServer = sendMessageToServer
