// Registers main-process error logging - must be first so it catches import-time errors
import { logMainError } from './errors'

import { app, ipcMain, Menu, dialog } from 'electron'

// set userData Path on portable version
import './portable'

// set defaults of environment variables
import 'dotenv/config'
process.env.TABBY_PLUGINS ??= ''
process.env.TABBY_CONFIG_DIRECTORY ??= app.getPath('userData')

import 'source-map-support/register'
import './lru'
import { parseArgs } from './cli'
import { Application } from './app'
import electronDebug from 'electron-debug'
import { loadConfig } from './config'

const argv = parseArgs(process.argv, process.cwd())

// eslint-disable-next-line @typescript-eslint/init-declarations
let configStore: any

try {
    configStore = loadConfig()
} catch (err) {
    dialog.showErrorBox('Could not read config', err.message)
    app.exit(1)
}

process.mainModule = module

const application = new Application(configStore)

// Register tabby:// URL scheme
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('tabby', process.execPath, [process.argv[1]])
    }
} else {
    app.setAsDefaultProtocolClient('tabby')
}

ipcMain.on('app:new-window', () => {
    application.newWindow()
})

process.on('uncaughtException', err => {
    application.broadcast('uncaughtException', err)
})

if (argv.d) {
    electronDebug({
        isEnabled: true,
        showDevTools: true,
        devToolsMode: 'undocked',
    })
}

app.on('activate', async () => {
    if (!application.hasWindows()) {
        application.newWindow()
    } else {
        application.focus()
    }
})

// Handle URL scheme on macOS
app.on('open-url', async (event, url) => {
    event.preventDefault()
    console.log('Received open-url event:', url)
    if (!application.hasWindows()) {
        process.argv.push(url)
    } else {
        await app.whenReady()
        application.handleSecondInstance([url], process.cwd())
    }
})

// Chromium rewrites the argv it forwards to the first instance: switches get hoisted
// ahead of positionals, its own switches are injected, and a `--opt value` pair is split
// apart. Send our own pristine argv alongside so the first instance sees exactly what
// the user typed, and only fall back to the forwarded copy if it is missing.
app.on('second-instance', async (_event, newArgv, cwd, additionalData: any) => {
    // This crosses a process boundary, so treat it as untrusted and fall back to
    // Electron's own copy unless it has the shape we sent
    const forwardedArgv = Array.isArray(additionalData?.argv) ? additionalData.argv : newArgv
    const forwardedCwd = typeof additionalData?.cwd === 'string' ? additionalData.cwd : cwd
    application.handleSecondInstance(forwardedArgv, forwardedCwd)
})

if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() })) {
    app.quit()
    app.exit(0)
}

app.on('ready', async () => {
    if (process.platform === 'darwin') {
        app.dock.setMenu(Menu.buildFromTemplate([
            {
                label: 'New window',
                click () {
                    this.app.newWindow()
                },
            },
        ]))
    }

    try {
        application.init()

        const window = await application.newWindow({ hidden: argv.hidden })
        await window.ready
        window.passCliArguments(process.argv, process.cwd(), false)
        window.focus()
    } catch (err) {
        logMainError('Failed to open window', err)
        dialog.showErrorBox('Tabby failed to start', String(err?.stack ?? err))
        app.exit(1)
    }
})
