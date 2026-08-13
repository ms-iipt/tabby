/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import { Socket } from 'net'
import colors from 'ansi-colors'
import stripAnsi from 'strip-ansi'
import { Injector } from '@angular/core'
import { LogService } from 'tabby-core'
import { BaseSession, ConnectableTerminalProfile, InputProcessingOptions, InputProcessor, LoginScriptsOptions, SessionMiddleware, StreamProcessingOptions, TerminalStreamProcessor } from 'tabby-terminal'
import { Subject, Observable } from 'rxjs'


export interface TelnetProfile extends ConnectableTerminalProfile {
    options: TelnetProfileOptions
}

/**
 * `xterm` over `xterm-256color`: it is present in essentially every terminfo database,
 * including AIX, and a TERM the server cannot resolve is far more disruptive than the
 * loss of 256 colours. Override per profile where the server is known to support more.
 */
export const DEFAULT_TERMINAL_TYPE = 'xterm'

export interface TelnetProfileOptions extends StreamProcessingOptions, LoginScriptsOptions {
    host: string
    port: number | null
    /**
     * Reported to the server via the TERMINAL-TYPE option, which is where the remote
     * `TERM` comes from. Has to name an entry the server's terminfo actually carries -
     * AIX in particular often ships `xterm` but not `xterm-256color`, and an unknown
     * TERM breaks vi, smit and anything else that addresses the cursor.
     */
    terminalType: string | null
    input: InputProcessingOptions,
}

enum TelnetCommands {
    SUBOPTION_SEND = 1,
    SUBOPTION_END = 240,
    GA = 249,
    SUBOPTION = 250,
    WILL = 251,
    WONT = 252,
    DO = 253,
    DONT = 254,
    IAC = 255,
}

enum TelnetOptions {
    ECHO = 0x1,
    AUTH_OPTIONS = 0x25,
    SUPPRESS_GO_AHEAD = 0x03,
    TERMINAL_TYPE = 0x18,
    NEGO_WINDOW_SIZE = 0x1f,
    NEGO_TERMINAL_SPEED = 0x20,
    STATUS = 0x05,
    REMOTE_FLOW_CONTROL = 0x21,
    X_DISPLAY_LOCATION = 0x23,
    NEW_ENVIRON = 0x27,
}

const EMPTY_BUFFER = Buffer.alloc(0)

/**
 * How much of an unfinished telnet command we are willing to hold on to. Every real
 * subnegotiation is far smaller than this - NAWS is 4 bytes, TERMINAL-TYPE a handful,
 * NEW-ENVIRON a few hundred at worst. Passing this means the `IAC SB` was not really a
 * subnegotiation (an unescaped 0xFF in binary output, or a broken server), and without a
 * ceiling the buffer would grow for the rest of the session while no further output ever
 * reached the terminal.
 */
const MAX_PENDING_BYTES = 4096

/**
 * Locates the `IAC SE` that closes a subnegotiation, skipping `IAC IAC` escapes inside
 * the payload. Returns -1 while the terminator has not arrived yet.
 */
function indexOfSuboptionEnd (data: Buffer): number {
    let i = 2
    while (i < data.length - 1) {
        if (data[i] === TelnetCommands.IAC) {
            if (data[i + 1] === TelnetCommands.SUBOPTION_END) {
                return i
            }
            if (data[i + 1] === TelnetCommands.IAC) {
                i += 2
                continue
            }
        }
        i++
    }
    return -1
}

class UnescapeFFMiddleware extends SessionMiddleware {
    feedFromSession (data: Buffer): void {
        while (data.includes(0xff)) {
            const pos = data.indexOf(0xff)

            this.outputToTerminal.next(data.slice(0, pos))
            this.outputToTerminal.next(Buffer.from([0xff, 0xff]))

            data = data.slice(pos + 1)
        }

        this.outputToTerminal.next(data)
    }
}

export class TelnetSession extends BaseSession {
    get serviceMessage$ (): Observable<string> { return this.serviceMessage }

    private serviceMessage = new Subject<string>()
    private socket: Socket
    private streamProcessor: TerminalStreamProcessor
    private telnetProtocol = false
    /** An incomplete telnet sequence held back until the rest of it arrives */
    private telnetPending = EMPTY_BUFFER
    private lastWidth = 0
    private lastHeight = 0
    private requestedOptions = new Set<number>()
    private telnetRemoteEcho = false

    constructor (
        injector: Injector,
        public profile: TelnetProfile,
    ) {
        super(injector.get(LogService).create(`telnet-${profile.options.host}-${profile.options.port}`))
        this.streamProcessor = new TerminalStreamProcessor(profile.options)
        this.middleware.push(this.streamProcessor)
        this.middleware.push(new InputProcessor(profile.options.input))
        this.setLoginScriptsOptions(profile.options)
    }

    async start (): Promise<void> {
        this.socket = new Socket()
        this.emitServiceMessage(`Connecting to ${this.profile.options.host}`)

        return new Promise((resolve, reject) => {
            this.socket.on('error', err => {
                this.emitServiceMessage(colors.bgRed.black(' X ') + ` Socket error: ${err as any}`)
                reject(err)
                this.destroy()
            })
            this.socket.on('close', () => {
                this.emitServiceMessage('Connection closed')
                this.destroy()
            })
            this.socket.on('data', data => this.onData(data))
            this.socket.connect(this.profile.options.port ?? 23, this.profile.options.host, () => {
                this.emitServiceMessage('Connected')
                this.open = true
                setTimeout(() => this.streamProcessor.start())
                this.loginScriptProcessor?.executeUnconditionalScripts()
                resolve()
            })
        })
    }

    requestOption (cmd: TelnetCommands, option: TelnetOptions): void {
        this.requestedOptions.add(option)
        this.emitTelnet(cmd, option)
    }

    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.info(stripAnsi(msg))
    }

    onData (data: Buffer): void {
        if (!this.telnetProtocol && data[0] === TelnetCommands.IAC) {
            this.telnetProtocol = true
            this.middleware.push(new UnescapeFFMiddleware())
            this.requestOption(TelnetCommands.DO, TelnetOptions.SUPPRESS_GO_AHEAD)
            this.emitTelnet(TelnetCommands.WILL, TelnetOptions.TERMINAL_TYPE)
            this.emitTelnet(TelnetCommands.WILL, TelnetOptions.NEGO_WINDOW_SIZE)
        }
        if (this.telnetProtocol) {
            data = this.processTelnetProtocol(data)
        }
        this.emitOutput(data)
    }

    emitTelnet (command: TelnetCommands, option: TelnetOptions): void {
        this.logger.debug('>', TelnetCommands[command], TelnetOptions[option] || option)
        this.socket.write(Buffer.from([TelnetCommands.IAC, command, option]))
    }

    emitTelnetSuboption (option: TelnetOptions, value: Buffer): void {
        this.logger.debug('>', 'SUBOPTION', TelnetOptions[option], value)
        // RFC 855: a literal 0xFF in the payload has to be doubled or the server reads it
        // as the start of a command. Reachable through NAWS whenever a window dimension
        // lands on 255, which truncated the size report and left the remote side with the
        // wrong geometry.
        const escaped: number[] = []
        for (const byte of value) {
            escaped.push(byte)
            if (byte === TelnetCommands.IAC) {
                escaped.push(TelnetCommands.IAC)
            }
        }
        this.socket.write(Buffer.from([
            TelnetCommands.IAC,
            TelnetCommands.SUBOPTION,
            option,
            ...escaped,
            TelnetCommands.IAC,
            TelnetCommands.SUBOPTION_END,
        ]))
    }

    /**
     * Strips telnet commands out of the stream and returns only the bytes bound for the
     * terminal.
     *
     * Commands are located anywhere in the buffer, not just at its head: real servers
     * interleave negotiation with output (`"Password: " IAC WILL ECHO`), and a command
     * can straddle a TCP segment boundary. Handling only the leading byte dropped those
     * negotiations and printed the raw command bytes to the terminal instead.
     */
    processTelnetProtocol (data: Buffer): Buffer {
        data = Buffer.concat([this.telnetPending, data])
        this.telnetPending = EMPTY_BUFFER
        const passthrough: Buffer[] = []

        while (data.length) {
            const iacIndex = data.indexOf(TelnetCommands.IAC)
            if (iacIndex === -1) {
                passthrough.push(data)
                break
            }
            if (iacIndex > 0) {
                passthrough.push(data.slice(0, iacIndex))
                data = data.slice(iacIndex)
                continue
            }

            // data[0] is IAC - hold anything incomplete back until the rest arrives
            if (data.length < 2) {
                this.telnetPending = data
                break
            }
            const command = data[1]

            if (command === TelnetCommands.IAC) {
                // An escaped 0xFF: one literal data byte. UnescapeFFMiddleware re-doubles
                // it on the way to the terminal, so emit it single here.
                passthrough.push(data.slice(0, 1))
                data = data.slice(2)
                continue
            }

            if (command === TelnetCommands.SUBOPTION) {
                const endIndex = indexOfSuboptionEnd(data)
                if (endIndex === -1) {
                    if (data.length > MAX_PENDING_BYTES) {
                        // Give up on this one and resynchronise on the next IAC. Costs the
                        // two prefix bytes; the alternative is a session that silently
                        // stops displaying anything at all.
                        this.logger.debug('(!) Unterminated suboption, resynchronising')
                        data = data.slice(2)
                        continue
                    }
                    this.telnetPending = data
                    break
                }
                this.handleSuboption(data[2], data.slice(3, endIndex))
                data = data.slice(endIndex + 2)
                continue
            }

            if ([TelnetCommands.WILL, TelnetCommands.WONT, TelnetCommands.DO, TelnetCommands.DONT].includes(command)) {
                if (data.length < 3) {
                    this.telnetPending = data
                    break
                }
                this.handleNegotiation(command, data[2])
                data = data.slice(3)
                continue
            }

            // Any other command carries no option byte
            this.logger.debug('<', TelnetCommands[command] || command)
            data = data.slice(2)
        }

        return Buffer.concat(passthrough)
    }

    private handleNegotiation (command: TelnetCommands, option: TelnetOptions): void {
        this.logger.debug('<', TelnetCommands[command] || command, TelnetOptions[option] || option)

        if (command === TelnetCommands.WILL || command === TelnetCommands.WONT || command === TelnetCommands.DONT) {
            if (this.requestedOptions.has(option)) {
                this.requestedOptions.delete(option)
                return
            }
        }

        if (command === TelnetCommands.WILL) {
            if ([
                TelnetOptions.SUPPRESS_GO_AHEAD,
                TelnetOptions.ECHO,
            ].includes(option)) {
                this.emitTelnet(TelnetCommands.DO, option)
                if (option === TelnetOptions.ECHO && this.streamProcessor.forceEcho) {
                    this.telnetRemoteEcho = true
                    this.streamProcessor.forceEcho = false
                    this.requestOption(TelnetCommands.WONT, option)
                }
            } else {
                this.logger.debug('(!) Unhandled option')
                this.emitTelnet(TelnetCommands.DONT, option)
            }
        }
        if (command === TelnetCommands.DO) {
            if (option === TelnetOptions.NEGO_WINDOW_SIZE) {
                this.emitTelnet(TelnetCommands.WILL, option)
                this.emitSize()
            } else if (option === TelnetOptions.ECHO) {
                if (this.telnetRemoteEcho) {
                    this.streamProcessor.forceEcho = false
                    this.emitTelnet(TelnetCommands.WONT, option)
                } else {
                    this.streamProcessor.forceEcho = true
                    this.emitTelnet(TelnetCommands.WILL, option)
                }
            } else if (option === TelnetOptions.TERMINAL_TYPE) {
                this.emitTelnet(TelnetCommands.WILL, option)
            } else {
                this.logger.debug('(!) Unhandled option')
                this.emitTelnet(TelnetCommands.WONT, option)
            }
        }
        if (command === TelnetCommands.DONT) {
            if (option === TelnetOptions.ECHO) {
                this.streamProcessor.forceEcho = false
            } else {
                this.logger.debug('(!) Unhandled option')
            }
            this.emitTelnet(TelnetCommands.WONT, option)
        }
        if (command === TelnetCommands.WONT) {
            if (option === TelnetOptions.ECHO) {
                this.telnetRemoteEcho = false
            } else {
                this.logger.debug('(!) Unhandled option')
            }
            this.emitTelnet(TelnetCommands.DONT, option)
        }
    }

    private handleSuboption (option: TelnetOptions, value: Buffer): void {
        this.logger.debug('<', 'SUBOPTION', TelnetOptions[option] || option, value)

        if (option === TelnetOptions.TERMINAL_TYPE && value[0] === TelnetCommands.SUBOPTION_SEND) {
            // Treat a blank field as "unset" - an empty TERM is worse than the default
            const configured = this.profile.options.terminalType?.trim()
            const terminalType = configured ? configured : DEFAULT_TERMINAL_TYPE
            this.emitTelnetSuboption(option, Buffer.from([0, ...Buffer.from(terminalType, 'ascii')]))
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    resize (w: number, h: number): void {
        if (w && h) {
            this.lastWidth = w
            this.lastHeight = h
        }
        if (this.lastWidth && this.lastHeight && this.telnetProtocol) {
            this.emitSize()
        }
    }

    private emitSize () {
        if (this.lastWidth && this.lastHeight) {
            this.emitTelnetSuboption(TelnetOptions.NEGO_WINDOW_SIZE, Buffer.from([
                this.lastWidth >> 8, this.lastWidth & 0xff,
                this.lastHeight >> 8, this.lastHeight & 0xff,
            ]))
        } else {
            this.emitTelnet(TelnetCommands.WONT, TelnetOptions.NEGO_WINDOW_SIZE)
        }
    }

    write (data: Buffer): void {
        this.socket.write(data)
    }

    kill (_signal?: string): void {
        this.socket.destroy()
    }

    async destroy (): Promise<void> {
        this.streamProcessor.close()
        this.serviceMessage.complete()
        this.kill()
        await super.destroy()
    }

    async getChildProcesses (): Promise<any[]> {
        return []
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill()
    }

    supportsWorkingDirectory (): boolean {
        return false
    }

    async getWorkingDirectory (): Promise<string|null> {
        return null
    }
}
