import { Injectable } from '@angular/core'
import { PlatformService } from '../api'

@Injectable({ providedIn: 'root' })
export class HomeBaseService {
    appVersion: string

    /** @hidden */
    private constructor (
        platform: PlatformService,
    ) {
        this.appVersion = platform.getAppVersion()
    }
}
