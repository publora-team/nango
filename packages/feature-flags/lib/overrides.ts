import { getLogger } from '@nangohq/utils';

import { envs } from './env.js';

import type { FlagValueType } from './types.js';

const logger = getLogger('FeatureFlags');

/**
 * One env var per flag, named after the flag key uppercased with dashes as underscores:
 * `NANGO_FEATURE_FLAG_AUDIT_TRAIL=true` overrides the `audit-trail` flag.
 *
 * Overrides win over the provider, so local development and self-hosted deployments can
 * change a flag without running an Unleash instance.
 */
const OVERRIDE_PREFIX = 'NANGO_FEATURE_FLAG_';

export type FlagOverrides = Map<string, string>;

/**
 * The overrides that apply to this process. Always empty on cloud, where an env var must not
 * become a way to pin a value in production, bypassing the provider.
 */
export function getFlagOverrides(): FlagOverrides {
    const overrides: FlagOverrides = new Map();
    if (envs.NANGO_CLOUD) {
        return overrides;
    }

    for (const [name, value] of Object.entries(process.env)) {
        if (value === undefined || !name.startsWith(OVERRIDE_PREFIX)) {
            continue;
        }
        const key = name.slice(OVERRIDE_PREFIX.length).toLowerCase().replaceAll('_', '-');
        if (key) {
            overrides.set(key, value);
        }
    }

    return overrides;
}

/**
 * The override for this flag, or `undefined` when there is none or its value doesn't fit the
 * flag's type. An unusable value is ignored.
 */
export function readFlagOverride<T>(key: string, type: FlagValueType, overrides: FlagOverrides): T | undefined {
    const raw = overrides.get(key);
    if (raw === undefined) {
        return undefined;
    }

    const value = coerce(raw, type);
    if (value === undefined) {
        logger.warning('Ignoring feature flag override, value does not match the flag type', { key, type, value: raw });
        return undefined;
    }

    return value as T;
}

function coerce(raw: string, type: FlagValueType): unknown {
    switch (type) {
        case 'boolean': {
            const normalized = raw.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
            return undefined;
        }
        case 'number': {
            const trimmed = raw.trim();
            if (trimmed === '') return undefined;
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        case 'string':
            return raw;
        case 'object':
            try {
                return JSON.parse(raw);
            } catch {
                return undefined;
            }
    }
}
