import { Observable, of } from 'rxjs'
import { Injectable, Inject } from '@angular/core'
import { Logger, LogService, PlatformService, BOOTSTRAP_DATA, BootstrapData, PluginInfo } from 'tabby-core'

@Injectable({ providedIn: 'root' })
export class PluginManagerService {
    logger: Logger
    userPluginsPath: string
    installedPlugins: PluginInfo[]

    private constructor (
        log: LogService,
        private platform: PlatformService,
        @Inject(BOOTSTRAP_DATA) bootstrapData: BootstrapData,
    ) {
        this.logger = log.create('pluginManager')
        this.installedPlugins = [...bootstrapData.installedPlugins]
        this.installedPlugins.sort((a, b) => a.name.localeCompare(b.name))
        this.userPluginsPath = bootstrapData.userPluginsPath
    }

    listAvailable (_query?: string): Observable<PluginInfo[]> {
        // The plugin registry lives on npm, which an air-gapped install cannot reach.
        // Returning nothing keeps the Plugins tab usable for managing what is already
        // installed without the app ever making an outbound request.
        return of([])
    }

    listInstalled (query: string): Observable<PluginInfo[]> {
        return of(this.installedPlugins.filter(x=>x.name.includes(query)))
    }

    async installPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.installPlugin(plugin.packageName, plugin.version)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
            this.installedPlugins.push(plugin)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }

    async uninstallPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.uninstallPlugin(plugin.packageName)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }
}
