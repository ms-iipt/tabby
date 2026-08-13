import { Injectable } from '@angular/core'
import { HostAppService } from './api/hostApp'
import { CLIHandler, CLIEvent, withCLITitle } from './api/cli'
import { HostWindowService } from './api/hostWindow'
import { QuickConnectProfileProvider } from './api/profileProvider'
import { ProfilesService } from './services/profiles.service'

// Schemes that never denote a connection profile provider
const NON_PROFILE_URL_SCHEMES = ['tabby', 'file', 'http', 'https']

/**
 * Splits `telnet://1.2.3.4:23` into the `telnet` provider and the
 * `1.2.3.4:23` quick connect query
 */
export function parseQuickConnectURL (arg: unknown): { providerId: string, query: string }|null {
    if (typeof arg !== 'string') {
        return null
    }
    const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(arg)
    if (!match) {
        return null
    }
    const providerId = match[1].toLowerCase()
    if (NON_PROFILE_URL_SCHEMES.includes(providerId)) {
        return null
    }
    const query = match[2].replace(/\/+$/, '')
    if (!query) {
        return null
    }
    return { providerId, query }
}

@Injectable()
export class ProfileCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = 0

    constructor (
        private profiles: ProfilesService,
        private hostWindow: HostWindowService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        const op = event.argv._[0]

        if (op === 'profile') {
            this.handleOpenProfile(event.argv.profileName!, event.argv.title)
            return true
        }
        if (op === 'recent') {
            this.handleOpenRecentProfile(event.argv.profileNumber!, event.argv.title)
            return true
        }
        if (op === 'quickConnect') {
            this.handleOpenQuickConnect(event.argv.providerId!, event.argv.query!, event.argv.title)
            return true
        }

        const url = parseQuickConnectURL(op)
        if (url && this.getQuickConnectProvider(url.providerId)) {
            this.handleOpenQuickConnect(url.providerId, url.query, event.argv.title)
            return true
        }

        return false
    }

    private async handleOpenProfile (profileName: string, title?: string) {
        const profile = (await this.profiles.getProfiles()).find(x => x.name === profileName)
        if (!profile) {
            console.error('Requested profile', profileName, 'not found')
            return
        }
        this.profiles.openNewTabForProfile(withCLITitle(profile, title))
        this.hostWindow.bringToFront()
    }

    private async handleOpenRecentProfile (profileNumber: number, title?: string) {
        const profiles = this.profiles.getRecentProfiles()
        if (profileNumber >= profiles.length) {
            return
        }
        this.profiles.openNewTabForProfile(withCLITitle(profiles[profileNumber], title))
        this.hostWindow.bringToFront()
    }

    private getQuickConnectProviders (): QuickConnectProfileProvider<any>[] {
        return this.profiles.getProviders()
            .filter((x): x is QuickConnectProfileProvider<any> => x instanceof QuickConnectProfileProvider)
    }

    private getQuickConnectProvider (providerId: string): QuickConnectProfileProvider<any>|undefined {
        return this.getQuickConnectProviders().find(x => x.id.toLowerCase() === providerId.toLowerCase())
    }

    private async handleOpenQuickConnect (providerId: string, query: string, title?: string) {
        const provider = this.getQuickConnectProvider(providerId)
        if(!provider) {
            const available = this.getQuickConnectProviders().map(x => x.id).join(', ')
            console.error(`Requested provider "${providerId}" not found. Available providers: ${available}`)
            return
        }
        const profile = provider.quickConnect(query)
        if(!profile) {
            console.error(`Could not parse quick connect query "${query}"`)
            return
        }
        this.profiles.openNewTabForProfile(withCLITitle(profile, title))
        this.hostWindow.bringToFront()
    }
}

@Injectable()
export class LastCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = -999

    constructor (private hostApp: HostAppService) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        if (event.secondInstance) {
            this.hostApp.newWindow()
            return true
        }
        return false
    }
}
