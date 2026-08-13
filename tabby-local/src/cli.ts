import * as path from 'path'
import * as fs from 'mz/fs'
import { Injectable } from '@angular/core'
import { CLIHandler, CLIEvent, AppService, ConfigService, HostWindowService, ProfilesService, NotificationsService, PlatformService, TranslateService, withCLITitle } from 'tabby-core'
import { TerminalService } from './services/terminal.service'

@Injectable()
export class TerminalCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = 0

    constructor (
        private hostWindow: HostWindowService,
        private terminal: TerminalService,
        private platform: PlatformService,
        private translate: TranslateService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        const op = event.argv._[0]

        if (op === 'open') {
            this.handleOpenDirectory(path.resolve(event.cwd, event.argv.directory!), event.argv.title)
        } else if (op === 'run') {
            await this.handleRunCommand(event.argv.command!, event.argv.title)
        } else {
            return false
        }

        return true
    }

    private async handleOpenDirectory (directory: string, title?: string) {
        if (directory.length > 1 && (directory.endsWith('/') || directory.endsWith('\\'))) {
            directory = directory.substring(0, directory.length - 1)
        }
        if (await fs.exists(directory)) {
            if ((await fs.stat(directory)).isDirectory()) {
                const profile = title
                    ? withCLITitle(await this.terminal.getDefaultProfile(), title)
                    : undefined
                this.terminal.openTab(profile, directory)
                this.hostWindow.bringToFront()
            }
        }
    }

    private async handleRunCommand (command: string[], title?: string) {
        if ((await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant(`Run "{command}"?`, { command: command.join(' ') }),
            buttons: [
                this.translate.instant('Run'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 0,
            cancelId: 1,
        })).response === 1) {
            return
        }

        this.terminal.openTab(withCLITitle({
            type: 'local',
            name: '',
            options: {
                command: command[0],
                args: command.slice(1),
            },
        }, title), null, true)
        this.hostWindow.bringToFront()
    }
}


@Injectable()
export class OpenPathCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = -100

    constructor (
        private terminal: TerminalService,
        private profiles: ProfilesService,
        private hostWindow: HostWindowService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        const op = event.argv._[0]
        const opAsPath = op ? path.resolve(event.cwd, op) : null

        // `op` may be anything - a command, a URL - so it isn't necessarily an existing path
        if (!opAsPath || !await fs.exists(opAsPath)) {
            return false
        }

        const profile = await this.terminal.getDefaultProfile()

        if ((await fs.lstat(opAsPath)).isDirectory()) {
            this.terminal.openTab(profile, opAsPath)
            this.hostWindow.bringToFront()
            return true
        }

        if (opAsPath.endsWith('.sh') || opAsPath.endsWith('.command')) {
            profile.options!.pauseAfterExit = true
            profile.options?.args?.push(opAsPath)
            this.terminal.openTab(profile)
            this.hostWindow.bringToFront()
            return true
        } else if (opAsPath.endsWith('.bat')) {
            const psProfile = (await this.profiles.getProfiles()).find(x => x.id === 'cmd')
            if (psProfile) {
                psProfile.options!.pauseAfterExit = true
                psProfile.options?.args?.push(opAsPath)
                this.terminal.openTab(psProfile)
                this.hostWindow.bringToFront()
                return true
            }
        } else if (opAsPath.endsWith('.ps1')) {
            const cmdProfile = (await this.profiles.getProfiles()).find(x => x.id === 'powershell')
            if (cmdProfile) {
                cmdProfile.options!.pauseAfterExit = true
                cmdProfile.options?.args?.push(opAsPath)
                this.terminal.openTab(cmdProfile)
                this.hostWindow.bringToFront()
                return true
            }
        } else {
            this.notifications.error('Cannot handle scripts of this type')
        }

        return false
    }
}

@Injectable()
export class AutoOpenTabCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = -1000

    constructor (
        private app: AppService,
        private config: ConfigService,
        private terminal: TerminalService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        if (!event.secondInstance && this.config.store.terminal.autoOpen && !this.config.store.enableWelcomeTab) {
            this.app.ready$.subscribe(() => {
                if (this.app.tabs.length === 0) {
                    this.terminal.openTab()
                }
            })
            return true
        }
        return false
    }
}
