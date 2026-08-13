import { Injector, Component } from '@angular/core'

import { ConnectableTerminalProfile } from './interfaces'
import { BaseTerminalTabComponent } from './baseTerminalTab.component'
import { GetRecoveryTokenOptions, RecoveryToken } from 'tabby-core'


/**
 * A class to base your custom connectable terminal tabs on
 */
@Component({ template: '' })
export abstract class ConnectableTerminalTabComponent<P extends ConnectableTerminalProfile> extends BaseTerminalTabComponent<P> {

    protected isDisconnectedByHand = false

    constructor (protected injector: Injector) {
        super(injector)

        this.subscribeUntilDestroyed(this.hotkeys.hotkey$, hotkey => {
            if (!this.hasFocus) {
                return
            }

            switch (hotkey) {
                case 'reconnect-tab':
                    this.reconnect()
                    this.notifications.notice(this.translate.instant('Reconnect'))
                    break
                case 'disconnect-tab':
                    this.disconnect()
                    this.notifications.notice(this.translate.instant('Disconnect'))
                    break
            }
        })
    }

    ngOnInit (): void {
        this.logger = this.log.create(`${this.profile.type}Tab`)

        super.ngOnInit()
    }

    protected onFrontendReady (): void {
        this.initializeSession().then(() => {
            this.clearServiceMessagesOnConnect()
        })
        super.onFrontendReady()
    }

    /**
    * Initialize Connectable Session.
    */
    async initializeSession (): Promise<void> {
        this.isDisconnectedByHand = false
    }

    /**
    * Method called when session is destroyed. Handle the tab behavior on session end for connectable tab
    */
    protected onSessionDestroyed (): void {
        super.onSessionDestroyed()

        if (this.frontend && this.profile.behaviorOnSessionEnd === 'reconnect' && !this.isDisconnectedByHand) {
            this.reconnect()
        }
        // Otherwise the tab is simply left as it is. It used to print "Press any key to
        // reconnect" and reconnect on the next keystroke, which fires on any stray input
        // - the session's own "Connection closed" notice already says what happened, and
        // reconnecting stays deliberate: the toolbar button, the tab context menu, or the
        // "Reconnect current tab" hotkey.
    }

    /**
     * Return true if tab should be destroyed on session closed.
     */
    protected shouldTabBeDestroyedOnSessionClose (): boolean {
        if (this.isDisconnectedByHand) {
            return false
        }
        return super.shouldTabBeDestroyedOnSessionClose()
    }

    async getRecoveryToken (options?: GetRecoveryTokenOptions): Promise<RecoveryToken> {
        return {
            type: `app:${this.profile.type}-tab`,
            profile: this.profile,
            savedState: options?.includeState && this.frontend?.saveState(),
        }
    }

    async disconnect (): Promise<void> {
        this.isDisconnectedByHand = true
        await this.session?.destroy()
    }

    async reconnect (): Promise<void> {
        this.session?.destroy()
        this.frontend?.resetTerminalModes()
        await this.initializeSession()
        this.clearServiceMessagesOnConnect()
        this.session?.releaseInitialDataBuffer()
    }

    private clearServiceMessagesOnConnect (): void {
        if (this.profile.clearServiceMessagesOnConnect && this.session?.open) {
            this.frontend?.clear()
        }
    }

}
