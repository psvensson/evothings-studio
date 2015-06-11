/*
File: hyper-ui.js
Description: HyperReload UI functionality.
Author: Mikael Kindborg

License:

Copyright (c) 2013-2014 Mikael Kindborg

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

// Code below is split into two parts, one for the UI
// and one for ther server. This is to prepare for an
// eventual headless version of HyperReload. Code currently
// contains serveral dependencies, however.

/*** Imported modules ***/

var FS = require('fs')
var PATH = require('path')
var OS = require('os')
var GUI = require('nw.gui')
var FILEUTIL = require('../server/fileutil.js')
var SETTINGS = require('../settings/settings.js')
var LOGGER = require('../server/log.js')

var AUTHCOLLECTOR = require('../server/auth-collector-service.js')

/*** Globals ***/

// Global object that holds globally available functions.
var hyper = {}

// Global Node.js reference to the main hyper object.
// Useful for e.g. access from the JavaScript interactive tools.
global.mainHyper = hyper

// UI-related functions.
hyper.UI = {}

/*** UI setup ***/

;(function()
{
	var mWorkbenchWindow = null

	function setupUI()
	{
		createSystemMenuForOSX()
		styleUI()
		setUIActions()
		setWindowActions()
		setUpFileDrop()
		restoreSavedUIState()
        startAuthCollector()
	}

	// System menus must be explicitly created on OS X,
	// see node-webkit documentation:
	// https://github.com/rogerwang/node-webkit/wiki/Menu#menucreatemacbuiltinappname
	function createSystemMenuForOSX()
	{
		if ('darwin' == OS.platform())
		{
			try
			{
				var appName = getApplicationName()
				var win = GUI.Window.get()
				var nativeMenuBar = new GUI.Menu({ type: 'menubar' })
				nativeMenuBar.createMacBuiltin(appName)
				win.menu = nativeMenuBar;
			}
			catch (ex)
			{
				LOGGER.log('Error creating OS X menubar: ' + ex.message);
			}
		}
	}

    function startAuthCollector()
    {
        //AUTHCOLLECTOR.start()

        /*
        GUI.window.on('document-end', function()
        {
            console.log('window loaded. args ->')
            console.dir(arguments)

        })
        */
    }

	// Helper function that returns the application name
	// specified in package.json.
	function getApplicationName()
	{
		var data = FILEUTIL.readFileSync('package.json')
		var applicationName = JSON.parse(data).name
		return applicationName
	}

	function styleUI()
	{
		// Apply jQuery UI button style.
		//$('button').button()

		// Set layout properties.
		/*
		$('body').layout(
		{
			west: { size: 400 },
			center: { maskContents: true },
			fxName: 'none'
		})
		*/
	}

	function setUIActions()
	{
		var button = null

		// Workbench button action.
		button = $('#button-workbench')
		button && button.click(function()
		{
			if (mWorkbenchWindow && !mWorkbenchWindow.closed)
			{
				// Bring existing window to front.
				mWorkbenchWindow.focus()
			}
			else
			{
				// Create new window.
				/* This does not work:
				mWorkbenchWindow = GUI.Window.open('hyper-workbench.html', {
					//position: 'mouse',
					width: 901,
					height: 600,
					focus: true
				})*/
				mWorkbenchWindow = window.open(
					'hyper-workbench.html',
					'workbench',
					'resizable=1,width=800,height=600')
				mWorkbenchWindow.moveTo(50, 50)
				mWorkbenchWindow.focus()
				// Establish contact. Not really needed.
				mWorkbenchWindow.postMessage({ message: 'hyper.hello' }, '*')
			}
		})

		// Enable reorder of project list by drag and drop.
		$(function()
		{
			$('#project-list').sortable(
			{
				stop: function()
				{
					updateProjectList()
				}
			})
			$('#project-list').disableSelection()
		})

		// Message handler.
		window.addEventListener('message', receiveMessage, false)

		// Display of file monitor counter.
		setInterval(function() {
			hyper.UI.displayNumberOfMonitoredFiles() },
			1500)
	}

	function setWindowActions()
	{
		// Listen to main window's close event
		GUI.Window.get().on('close', function()
		{
			try
			{
				saveUIState()

				if (mWorkbenchWindow && !mWorkbenchWindow.closed)
				{
					mWorkbenchWindow.window.saveUIState()
				}
			}
			catch(e)
			{
				// app is closing; no way to handle errors beyond logging them.
				LOGGER.log(e);
			}

			GUI.App.quit()
		})
	}

	function saveUIState()
	{
		var win = GUI.Window.get()

		// Do not save if window is minimized on Windows.
		// On Windows an icon has x,y coords -32000 when
		// window is minimized. On Linux and OS X the window
		// coordinates and size are intact when minimized.
		if (win.x < -1000)
		{
			return;
		}

		SETTINGS.setProjectWindowGeometry({
			x: win.x,
			y: win.y,
			width: win.width,
			height: win.height
			})
	}

	function restoreSavedUIState()
	{
		var geometry = SETTINGS.getProjectWindowGeometry()
		if (geometry)
		{
			var win = GUI.Window.get()

			// Make sure top-left corner is visible.
			var offsetY = 0
			if ('darwin' == OS.platform())
			{
				offsetY = 22
			}
			geometry.x = Math.max(geometry.x, 1)
			geometry.y = Math.max(geometry.y, 1 + offsetY)
			geometry.x = Math.min(geometry.x, screen.width - 100)
			geometry.y = Math.min(geometry.y, screen.height - 200)

			// Set window size.
			win.x = geometry.x
			win.y = geometry.y
			win.width = geometry.width
			win.height = geometry.height
		}
	}

	function receiveMessage(event)
	{
		//LOGGER.log('Main got : ' + event.data.message)
		if ('eval' == event.data.message)
		{
			hyper.SERVER.evalJS(event.data.code)
		}
        else if ('setSession' == event.data.message)
        {
            console.log('==== session set to '+event.data.sid)

        }
	}

	function setUpFileDrop()
	{
		var originalDropTaget = null

		// Block change page on drop.
		window.ondragover = function(e) { e.preventDefault(); return false }
		window.ondragend = function(e) { e.preventDefault(); return false }
		window.ondrop = function(e) { e.preventDefault(); return false }

		// Set up drop handling using a drop target overlay area.
		var dropTarget = $('#panel-page')
		var enterTarget;
		dropTarget.on('dragenter', function(e)
		{
			e.stopPropagation()
			e.preventDefault()
			$('#drag-overlay').show();
			enterTarget = event.target;
		})
		dropTarget.on('dragleave', function(e)
		{
			if (enterTarget == event.target) {
				e.stopPropagation()
				e.preventDefault()
				$('#drag-overlay').hide();
			}
		})
		dropTarget.on('drop', function(e)
		{
			e.stopPropagation()
			e.preventDefault()
			$('#drag-overlay').hide();
			handleFileDrop(e.originalEvent.dataTransfer.files)
		})
	}

	function handleFileDrop(files)
	{
		// Debug print.
		/*for (var i = 0; i < files.length; ++i)
		{
			LOGGER.log(files[i].path);
		}*/

		for (var i = 0; i < files.length; ++i)
		{
			var path = files[i].path
			if (FILEUTIL.fileIsHTML(path))
			{
				//hyper.SERVER.setAppPath(path)
				hyper.addProject(path)
			}
			else
			{
				alert('Only HTML files (extension .html or .htm) can be used')
				break;
			}
		}

		hyper.UI.displayProjectList()
	}

	function createProjectEntry(path)
	{
		// Template for project items.
		var html =
			'<div class="ui-state-default ui-corner-all">'
				+ '<button '
				+	'type="button" '
				+	'class="button-open btn btn-default" '
				+	'onclick="hyper.openFileFolder(\'__PATH1__\')">'
				+	'Code'
				+ '</button>'
				+ '<button '
				+	'type="button" '
				+	'class="button-run btn btn-success" '
				+	'onclick="hyper.runAppGuard(\'__PATH2__\')">'
				+	'Run'
				+ '</button>'
				+ '<h4>__NAME__</h4>'
				+ '<p>__PATH3__</p>'
				+ '<button '
				+	'type="button" '
				+	'class="close button-delete" '
				+	'onclick="hyper.UI.deleteEntry(this)">'
				+	'&times;'
				+ '</button>'
				+ '<div class="project-list-entry-path" style="display:none;">__PATH4__</div>'
			+ '</div>'

		// Get name of project, use title tag as first choise.
		var data = FILEUTIL.readFileSync(path)
		if (!data)
		{
			// Return on error, skipping rest of the code.
			LOGGER.log('createProjectEntry failed: ' + path)
			return
		}

		var name = getTagContent(data, 'title')
		if (!name)
		{
			name = getNameFromPath(path)
		}

		// Escape any backslashes in the path (needed on Windows).
		var escapedPath = path.replace(/[\\]/g,'\\\\')

		// Replace fields in template.
		html = html.replace('__PATH1__', escapedPath)
		html = html.replace('__PATH2__', escapedPath)
		html = html.replace('__PATH3__', getShortPathFromPath(path))
		html = html.replace('__PATH4__', path)
		html = html.replace('__NAME__', name)

		// Create element.
		var element = $(html)
		//LOGGER.log(html)

		// Insert element first in list.
		$('#project-list').append(element)
	}

	function getTagContent(data, tag)
	{
		var tagStart = '<' + tag + '>'
		var tagEnd = '</' + tag + '>'
		var pos1 = data.indexOf(tagStart)
		if (-1 === pos1) { return null }
		var pos2 = data.indexOf(tagEnd)
		if (-1 === pos2) { return null }
		return data.substring(pos1 + tagStart.length, pos2)
	}

	// Use last part of path as name.
	// E.g. '/home/apps/HelloWorld/index.html' -> 'HelloWorld/index.html'
	// Use full path as fallback.
	function getNameFromPath(path)
	{
		path = path.replace(new RegExp("\\"+PATH.sep, 'g'), '/')
		var pos = path.lastIndexOf('/')
		if (-1 === pos) { return path }
		pos = path.lastIndexOf('/', pos - 1)
		if (-1 === pos) { return path }
		return path.substring(pos + 1)
	}

	// Get last part of path. Purpose is to make path fit
	// inside a project list item.
	function getShortPathFromPath(path)
	{
		var limit = 58
		if (path.length < limit)
		{
			return path
		}
		else
		{
			var shortPath = path.substring(path.length - limit, path.length)
			var index1 = shortPath.indexOf('/') // OS X, Linux
			var index2 = shortPath.indexOf('\\') // Windows
			if (index1 > -1)
			{
				return shortPath.substring(index1 + 1)
			}
			else if (index2 > -1)
			{
				return shortPath.substring(index2 + 1)
			}
			else
			{
				// Fallback
				return '...' + shortPath.substring(3, shortPath.length)
			}
		}
	}

	// Project list has been reordered/changed, save new list.
	// Reads data from the DOM tree.
	function updateProjectList()
	{
		var projects = []
		var elements = $('#project-list .project-list-entry-path')
		elements.each(function(index, element)
		{
			var path = $(element).text()
			if (path != '')
			{
				projects.push(path)
			}
		})
		hyper.setProjectList(projects)
	}

	hyper.UI.displayConnectStatus = function(status)
	{
		document.querySelector('#connect-address').innerHTML = status
	}

	hyper.UI.setConnectedCounter = function(value)
	{
		document.querySelector('#connect-counter').innerHTML = value
	}

	hyper.UI.displayNumberOfMonitoredFiles = function()
	{
		document.querySelector('#files-counter').innerHTML =
			hyper.MONITOR.getNumberOfMonitoredFiles()
	}

	hyper.UI.displayProjectList = function()
	{
		// Clear current list.
		$('#project-list').empty()

		// Create new list.
		var projectList = hyper.getProjectList()
		for (var i = 0; i < projectList.length; ++i)
		{
			var path = projectList[i]
			createProjectEntry(path)
		}
	}

	hyper.UI.setServerMessageFun = function()
	{
		// Set server message callback to forward message to the Workbench.
		hyper.SERVER.setMessageCallbackFun(function(msg)
		{
			// TODO: Send string do JSON.stringify on msg.
			if (mWorkbenchWindow)
			{
				mWorkbenchWindow.postMessage(msg, '*')
			}
		})
	}

	hyper.UI.deleteEntry = function(obj)
	{
		LOGGER.log($(obj).parent())
		$(obj).parent().remove()
		updateProjectList()
	}

	hyper.UI.showSettingsDialog = function(defaultServerAddress)
	{
		$('#input-setting-javascript-workbench-font-size').val(
			SETTINGS.getWorkbenchFontSize())
		$('#input-setting-number-of-directory-levels').val(
			SETTINGS.getNumberOfDirecoryLevelsToTraverse())
		$('#input-setting-reload-server-address').val(
			SETTINGS.getReloadServerAddress())
		$('#dialog-settings').modal('show')
	}

	hyper.UI.saveSettings = function(defaultServerAddress)
	{
		SETTINGS.setWorkbenchFontSize(
			$('#input-setting-javascript-workbench-font-size').val())
		SETTINGS.setNumberOfDirecoryLevelsToTraverse(
			parseInt($('#input-setting-number-of-directory-levels').val()))
		SETTINGS.setReloadServerAddress(
			$('#input-setting-reload-server-address').val())
		$('#dialog-settings').modal('hide')
	}

	hyper.UI.showConnectDialog = function(defaultServerAddress)
	{
		$('#input-connect-url').val(defaultServerAddress)
		$('#connect-spinner').css('display', 'none')
		$('#dialog-connect').modal('show')
	}

	// Called when the Connect button in the Connect dialog is clicked.
	hyper.UI.connectToServer = function()
	{
		//var key = $('#input-connect-key').val()
		//hyper.setUserKey(key)

		$('#connect-spinner').css('display', 'inline-block')
		hyper.stopServer()
		var url = $('#input-connect-url').val()
		hyper.setRemoteServerURL(url)
		hyper.startServer()

		// Let the user hide the dialog.
		//$('#dialog-connect').modal('hide')
	}

	// Called from connect status callback.
	hyper.UI.displayConnectKey = function(key)
	{
		$('#connect-spinner').css('display', 'none')
		$('#connect-key').html(key)
	}

	setupUI()
})()

/*** Server setup ***/

;(function()
{
	var SERVER = require('../server/hyper-server.js')
	var MONITOR = require('../server/filemonitor.js')

	hyper.SERVER = SERVER
	hyper.MONITOR = MONITOR

	var mProjectListFile = './hyper/settings/project-list.json'
	var mProjectList = []
	var mApplicationBasePath = process.cwd()
	var mRunAppGuardFlag = false
	var mNumberOfConnectedClients = 0
	var mConnectedCounterTimer = 0
	//var mIpAddressString = null

	hyper.setUpServer = function()
	{
		// Populate the UI.
		// TODO: Consider moving these calls to a function in hyper.UI.
		readProjectList()
		hyper.UI.displayProjectList()
		hyper.UI.setServerMessageFun()

		//displayServerIpAddress()
		//setInterval(checkServerIpAddressForRestart, 10000)

		SERVER.setClientConnenctedCallbackFun(clientConnectedCallback)
		SERVER.setReloadCallbackFun(reloadCallback)
		SERVER.setStatusCallbackFun(statusCallback)

		MONITOR.setFileSystemChangedCallbackFun(
			function() { SERVER.reloadApp() })
	}

	hyper.startServer = function()
	{
		// Start server tasks.
		SERVER.connectToRemoteServer()
		MONITOR.setTraverseNumDirectoryLevels(
			SETTINGS.getNumberOfDirecoryLevelsToTraverse())
		MONITOR.startFileSystemMonitor()
	}

	hyper.stopServer = function()
	{
		// Stop server tasks.
		SERVER.disconnectFromRemoteServer()
		MONITOR.stopFileSystemMonitor()
	}
/*
	// Check IP address and stop and start servers if it has changed.
	function checkServerIpAddressForRestart()
	{
		serverIpAddressDisplayString(function(addressString)
		{
			// If address string has changed, then display
			// the new address and restart servers.
			if (mIpAddressString != addressString)
			{
				mIpAddressString = addressString
				displayServerIpAddress()
				SERVER.restartServers()
			}
		})
	}

	function displayServerIpAddress()
	{
		serverIpAddressDisplayString(function(addressString)
		{
			// Save current address string.
			mIpAddressString = addressString
			hyper.UI.displayIpAddress(addressString)
		})
	}

	function serverIpAddressDisplayString(callback)
	{
		SERVER.getIpAddresses(function(addresses)
		{
			var connectAddress = ''
			var numAddresses = addresses.length
			if (numAddresses == 0)
			{
				connectAddress = '127.0.0.1:' + SETTINGS.getWebServerPort()
			}
			else
			{
				if (numAddresses > 1)
				{
					connectAddress = 'Try: '
				}
				for (var i = 0; i < numAddresses; ++i)
				{
					connectAddress += addresses[i] + ':' + SETTINGS.getWebServerPort()
					if (i + 1 < numAddresses)
					{
						connectAddress += ' or '
					}
				}
			}
			callback(connectAddress)
		})
	}
*/
	// The Run button in the UI has been clicked.
	// Clicking too fast can cause muliple windows
	// to open. Guard against this case.
	hyper.runAppGuard = function(path)
	{
		if (!mRunAppGuardFlag)
		{
			mRunAppGuardFlag = true
			hyper.runApp(path)
		}
	}

	// The Run button in the UI has been clicked.
	hyper.runApp = function(path)
	{
		// Prepend base path if this is not an absolute path.
		if (!FILEUTIL.isPathAbsolute(path))
		{
			path = mApplicationBasePath + '/' + path
		}

		LOGGER.log('runApp: ' + path)

		SERVER.setAppPath(path)
		MONITOR.setBasePath(SERVER.getBasePath())

		if (mNumberOfConnectedClients <= 0)
		{
			mRunAppGuardFlag = false
			hyper.noClientConnectedHander()
		}
		else
		{
			// Otherwise, load the requested file on connected clients.
			SERVER.runApp()
		}

		mNumberOfConnectedClients = 0

		clearTimeout(mConnectedCounterTimer)
		mConnectedCounterTimer = setTimeout(function() {
			hyper.UI.setConnectedCounter(mNumberOfConnectedClients) },
			5000)
	}

	hyper.noClientConnectedHander = function()
	{
		// Open a local browser automatially if no clients are connected.
		// This is done so that something will happen when you first try
		// out Hyper by clicking the buttons in the user interface.
		//GUI.Shell.openExternal(SERVER.getAppFileURL())
		GUI.Shell.openExternal(SERVER.getAppServerURL())
	}

	function clientConnectedCallback()
	{
		mRunAppGuardFlag = false

		++mNumberOfConnectedClients

		clearTimeout(mConnectedCounterTimer)
		mConnectedCounterTimer = setTimeout(function() {
			hyper.UI.setConnectedCounter(mNumberOfConnectedClients) },
			1000)

		// Update ip address in the UI to the actual ip used by the server.
		/*
		SERVER.getIpAddress(function(address) {
			hyper.UI.displayIpAddress(address + ':' +
			SETTINGS.getWebServerPort())
		})
		*/
	}

	function reloadCallback()
	{
		mNumberOfConnectedClients = 0
	}

	function statusCallback(message)
	{
		if (message.event == 'connected')
		{
			hyper.UI.displayConnectKey(message.key)
			hyper.UI.displayConnectStatus('Connected')
		}
		else if (message.event == 'disconnected')
		{
			hyper.UI.displayConnectStatus('Disconnected')
		}
	}

	function readProjectList()
	{
		/* Not used:
		// Create project file from template if it does not exist.
		if (!FS.existsSync(mProjectListFile))
		{
			var data = FS.readFileSync(mProjectListTemplateFile, {encoding: 'utf8'})
			FS.writeFileSync(mProjectListFile, data, {encoding: 'utf8'})
		}
		*/

		// Read project file.
		if (FS.existsSync(mProjectListFile))
		{
			var json = FILEUTIL.readFileSync(mProjectListFile)

			// Replace slashes with backslashes on Windows.
			if (process.platform === 'win32')
			{
				json = json.replace(/[\/]/g,'\\\\')
			}

			mProjectList = JSON.parse(json)
		}
	}

	function saveProjectList()
	{
		var json = JSON.stringify(mProjectList)
		FS.writeFileSync(mProjectListFile, json, {encoding: 'utf8'})
	}

	// TODO: Simplify, use updateProjectList instead.
	hyper.addProject = function(path)
	{
		mProjectList.unshift(path)
		saveProjectList()
	}

	hyper.setProjectList = function(list)
	{
		mProjectList = list
		saveProjectList()
	}

	hyper.getProjectList = function()
	{
		return mProjectList
	}

	function openFolder(path)
	{
		// Convert path separators on Windows.
		if (process.platform === 'win32')
		{
			path = path.replace(/[\/]/g,'\\')
		}

		// Debug logging.
		LOGGER.log('Open folder: ' + path)

		GUI.Shell.showItemInFolder(path)
	}

	hyper.openFileFolder = function(path)
	{
		// Prepend base path if this is not an absolute path.
		if (!FILEUTIL.isPathAbsolute(path))
		{
			path = mApplicationBasePath + '/' + path
		}

		// Show the file in the folder.
		openFolder(path)
	}

	/*
	hyper.setUserKey = function(key)
	{
		SERVER.setUserKey(key)
	}
	*/

	hyper.setRemoteServerURL = function(url)
	{
		SERVER.setRemoteServerURL(url)
	}
})()