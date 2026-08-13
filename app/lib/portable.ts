import * as path from 'path'
import * as fs from 'fs'
import * as electron from 'electron'

// electron-builder's `portable` target is a self-extracting stub: it unpacks the app into
// a temp directory and runs it from there, so getPath('exe') points at the throwaway copy
// rather than at the folder the user actually keeps Tabby in. It exports the real location
// as PORTABLE_EXECUTABLE_DIR for exactly this reason. For the zip build the variable is
// absent and getPath('exe') is already right.
const appPath = process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(electron.app.getPath('exe'))

const portableData = path.join(appPath, 'data')
if (fs.existsSync(portableData)) {
    console.log('reset user data to ' + portableData)
    electron.app.setPath('userData', portableData)
}
