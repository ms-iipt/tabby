import { PartialProfile, Profile } from './profileProvider'

export interface CLIEvent {
    argv: {
        _: string[],
        // Commands are hardcoded for now
        directory?: string,
        command?: string[],
        profileName?: string,
        text?: string,
        escape?: boolean,
        providerId?: string,
        query?: string,
        debug?: boolean,
        hidden?: boolean,
        profileNumber?: number,
        'new-window'?: boolean,
        'new-tab'?: boolean,
        title?: string,
    }
    cwd: string
    secondInstance: boolean
}

export abstract class CLIHandler {
    priority: number
    firstMatchOnly: boolean

    abstract handle (event: CLIEvent): Promise<boolean>
}

/**
 * Applies a tab title supplied via `--title` to a profile. The dynamic title is
 * turned off so the session can't overwrite what the user explicitly asked for.
 */
export function withCLITitle <P extends Profile> (profile: PartialProfile<P>, title?: string): PartialProfile<P> {
    if (!title) {
        return profile
    }
    return { ...profile, name: title, disableDynamicTitle: true }
}
