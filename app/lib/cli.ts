import { app } from 'electron'
import * as path from 'path'

export interface YargsOption {
    type?: 'string' | 'number' | 'boolean' | 'array'
    alias?: string
    describe?: string
    default?: any
    choices?: string[]
}

interface CommandConfig {
    command: string | string[]
    description: string
    options?: Record<string, YargsOption>
    positionals?: Record<string, YargsOption>
}

interface ParserConfig {
    usage: string
    commands: CommandConfig[]
    options: Record<string, YargsOption>
    version: string
}

export function createParserConfig (cwd: string): ParserConfig {
    return {
        usage: 'tabby [command] [arguments]',
        commands: [
            {
                command: 'open [directory]',
                description: 'open a shell in a directory',
                options: {
                    directory: { type: 'string', 'default': cwd },
                },
            },
            {
                command: ['run [command...]', '/k'],
                description: 'run a command in the terminal',
                options: {
                    command: { type: 'array' },
                },
            },
            {
                command: 'profile [profileName]',
                description: 'open a tab with specified profile',
                options: {
                    profileName: { type: 'string' },
                },
            },
            {
                command: 'paste [text]',
                description: 'paste stdin into the active tab',
                options: {
                    escape: {
                        alias: 'e',
                        type: 'boolean',
                        describe: 'Perform shell escaping',
                    },
                },
                positionals: {
                    text: { type: 'string' },
                },
            },
            {
                command: 'recent [index]',
                description: 'open a tab with a recent profile',
                options: {
                    profileNumber: { type: 'number' },
                },
            },
            {
                command: 'quickConnect <providerId> <query>',
                description: 'open a tab for specified quick connect provider',
                positionals: {
                    providerId: {
                        describe: 'The name of a quick connect profile provider',
                        type: 'string',
                    },
                    query: {
                        describe: 'The quick connect query string',
                        type: 'string',
                    },
                },
            },
        ],
        options: {
            debug: {
                alias: 'd',
                describe: 'Show DevTools on start',
                type: 'boolean',
            },
            hidden: {
                describe: 'Start minimized',
                type: 'boolean',
            },
            'new-window': {
                alias: 'w',
                describe: 'Open in a new window',
                type: 'boolean',
            },
            'new-tab': {
                alias: 't',
                describe: 'Open as a new tab in an already open window (default)',
                type: 'boolean',
            },
            title: {
                describe: 'Set the tab title, overriding the dynamic one',
                type: 'string',
            },
        },
        version: app.getVersion(),
    }
}

function applyOptionsToYargs (yargsInstance: any, options: Record<string, YargsOption>, method: 'option' | 'positional') {
    return Object.entries(options).reduce(
        (yargs, [key, value]) => yargs[method](key, value),
        yargsInstance,
    )
}

function createParserFromConfig (config: ParserConfig) {
    const yargs = require('yargs/yargs')
    // Without this yargs derives $0 from the executable, which reads as "Electron ..."
    // in a dev checkout and as the bundle name in a packaged build
    let parser = yargs().scriptName('tabby').usage(config.usage)
    config.commands.forEach(cmd => {
        const builder = (yargsInstance: any) => {
            let instance = yargsInstance
            if (cmd.options) {
                instance = applyOptionsToYargs(instance, cmd.options, 'option')
            }
            if (cmd.positionals) {
                instance = applyOptionsToYargs(instance, cmd.positionals, 'positional')
            }
            return instance
        }
        parser = parser.command(cmd.command, cmd.description, builder)
    })
    parser = applyOptionsToYargs(parser, config.options, 'option')
    return parser.version(config.version).help('help')
}

/**
 * Drops the argv entries that belong to the launcher rather than to the user: the
 * executable, plus the app path that is present when Electron runs as `electron <app>`.
 *
 * The app path is matched by value instead of by position because argv does not always
 * keep the order it was typed in - see the note in `index.ts` about `second-instance`.
 * Slicing a fixed number of entries there shifted every argument by one, which made
 * `tabby telnet://host` open a shell in the app directory instead of connecting.
 */
function stripLauncherArgs (argv: string[], cwd: string): string[] {
    const appPath = app.getAppPath()
    const isAppPath = (arg: string) => {
        if (arg === appPath) {
            return true
        }
        try {
            // Resolve against the invoking process's directory, not ours - on a
            // `second-instance` these arguments were typed somewhere else entirely
            return path.resolve(cwd, arg) === appPath
        } catch {
            return false
        }
    }
    return argv.slice(1).filter(arg => !isAppPath(arg))
}

export function parseArgs (argv: string[], cwd: string): any {
    const args = stripLauncherArgs(argv, cwd)
    const config = createParserConfig(cwd)
    try {
        return createParserFromConfig(config).parse(args)
    } catch (err) {
        // A parser failure must never take down an already running instance - yargs
        // renders usage text through cliui, which throws outright if its transitive
        // string-width/strip-ansi deps resolve to an ESM-only build. Fall back to the
        // bare positionals so a `tabby telnet://host` style invocation still works.
        console.error('Could not parse CLI arguments', args, err)
        return { _: args.filter(arg => !arg.startsWith('-')) }
    }
}

// Commands that act on an already open tab and can never be satisfied by a fresh window
const EXISTING_WINDOW_COMMANDS = ['paste']

function isFlagSet (argv: Record<string, any>, ...keys: string[]): boolean {
    return keys.some(key => argv[key] === true)
}

/**
 * Decides whether a CLI invocation gets its own window or is added as a tab
 * to an already open one. A new tab is the default.
 *
 * @param argv a parsed argument vector, as produced by `parseCliArguments`
 */
export function shouldOpenInNewWindow (argv: Record<string, any>): boolean {
    if (EXISTING_WINDOW_COMMANDS.includes(argv._?.[0])) {
        return false
    }
    // `--new-tab` only spells out the default, so `--new-window` always wins
    return isFlagSet(argv, 'new-window', 'newWindow')
}
