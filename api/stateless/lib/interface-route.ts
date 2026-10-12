import Config from '../../common/config.js';
import Err from '@openaddresses/batch-error';
import { Static } from '@sinclair/typebox';
import { Feature } from '@tak-ps/node-cot';
import { RouteConfig, RouteManagerConfig } from './routing/types.js';
import type { RerouteInput } from './routing/taklab.js';
import { arcgisSettingKeys } from './search/arcgis-settings.js';
import { ProviderManager } from './interface-provider.js';
import type { ProviderLoader, ProviderSettingKey } from './interface-provider.js';

/**
 * @class
 *
 * A Generic Routing Interface that can be extended to support different routing backends
 */
export interface RouteInterface {
    _id: string;
    _name: string;
    _config: Config;

    config(): Promise<Static<typeof RouteConfig>>;

    route(
        stops: Array<[number, number]>,
        travelMode?: string
    ): Promise<Static<typeof Feature.FeatureCollection>>;

    /** Przeliczenie części istniejącej trasy; tylko dostawcy z planem trasy. */
    reroute?(input: RerouteInput): Promise<Static<typeof Feature.FeatureCollection>>;
}

/**
 * @class
 * A Manager for different Routing providers
 */
export class RouteManager extends ProviderManager<RouteInterface> {
    label = 'Routing';

    settingKeys: ProviderSettingKey[] = [
        'taklab::routing::enabled', 'taklab::routing::graphhopper_url', 'taklab::routing::terrain_url',
        ...arcgisSettingKeys('routing'),
    ];

    // Pierwszy załadowany dostawca zostaje domyślny (interface-provider.ts),
    // a menu tras wybiera providers[0], więc kolejność listy jest decyzją.
    providers: ProviderLoader<RouteInterface>[] = [
        { name: 'taklab', load: async config => (await import('./routing/taklab.js')).default.init(config) },
        { name: 'AGOL', load: async config => (await import('./routing/agol.js')).default.init(config) },
    ];

    static async init(config: Config): Promise<RouteManager> {
        const manager = new RouteManager(config);

        await manager.refresh();

        return manager;
    }

    async config(): Promise<Static<typeof RouteManagerConfig>> {
        const settings: Static<typeof RouteManagerConfig> = {
            enabled: false,
            providers: [],
        };

        for (const route of this.values()) {
            settings.enabled = true;
            settings.providers.push(await route.config());
        }

        return settings;
    }

    async route(
        provider: string,
        stops: Array<[number, number]>,
        travelMode?: string,
    ): Promise<Static<typeof Feature.FeatureCollection>> {
        const route = this.get(provider);

        if (!route) {
            throw new Err(400, null, `Invalid routing provider: ${provider}`);
        }

        return await route.route(stops, travelMode);
    }

    async reroute(
        provider: string,
        input: RerouteInput,
    ): Promise<Static<typeof Feature.FeatureCollection>> {
        const route = this.get(provider);

        if (!route) {
            throw new Err(400, null, `Invalid routing provider: ${provider}`);
        }

        if (!route.reroute) {
            throw new Err(400, null, `Routing provider ${provider} does not support editing routes`);
        }

        return await route.reroute(input);
    }
}
