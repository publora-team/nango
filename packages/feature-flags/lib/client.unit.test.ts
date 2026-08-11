import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
}));

const mockIncrement = vi.hoisted(() => vi.fn());

const openFeatureClient = vi.hoisted(() => ({
    getBooleanValue: vi.fn(),
    getStringValue: vi.fn(),
    getNumberValue: vi.fn(),
    getObjectValue: vi.fn()
}));

vi.mock('@nangohq/utils', () => ({
    getLogger: vi.fn(() => mockLogger),
    metrics: {
        increment: mockIncrement,
        Types: {
            FEATURE_FLAGS_EVALUATED: 'nango.feature_flags.evaluated'
        }
    }
}));

vi.mock('./env.js', () => ({
    envs: { NANGO_CLOUD: false }
}));

vi.mock('@openfeature/server-sdk', () => ({
    OpenFeature: {
        setProvider: vi.fn(),
        getClient: vi.fn(() => openFeatureClient),
        setProviderAndWait: vi.fn()
    }
}));

describe('buildFeatureFlagsClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('logs and returns the default when evaluation fails', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getBooleanValue.mockRejectedValue(new Error('provider down'));
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map());
        await expect(client.isEnabled('my-flag', {}, false)).resolves.toBe(false);
        expect(mockLogger.warning).toHaveBeenCalledWith('Feature flag evaluation failed, using default', {
            key: 'my-flag',
            err: expect.any(Error)
        });
        expect(mockIncrement).toHaveBeenCalledWith('nango.feature_flags.evaluated', 1, {
            flag: 'my-flag',
            type: 'boolean',
            used_default: 'true',
            result: 'false'
        });
    });

    it('records evaluation metric on success', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getBooleanValue.mockResolvedValue(true);
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map());
        await expect(client.isEnabled('oauth-state-cookie-enforcement', { targetingKey: 'uuid1' }, false)).resolves.toBe(true);
        expect(mockIncrement).toHaveBeenCalledWith('nango.feature_flags.evaluated', 1, {
            flag: 'oauth-state-cookie-enforcement',
            type: 'boolean',
            result: 'true'
        });
    });

    it('records string evaluations without result tag', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getStringValue.mockResolvedValue('new-ui');
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map());
        await expect(client.getString('ui-variant', {}, 'old-ui')).resolves.toBe('new-ui');
        expect(mockIncrement).toHaveBeenCalledWith('nango.feature_flags.evaluated', 1, {
            flag: 'ui-variant',
            type: 'string'
        });
    });

    it('omits result tag for number evaluations', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getNumberValue.mockResolvedValue(42);
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map());
        await expect(client.getNumber('rate-limit', {}, 10)).resolves.toBe(42);
        expect(mockIncrement).toHaveBeenCalledWith('nango.feature_flags.evaluated', 1, {
            flag: 'rate-limit',
            type: 'number'
        });
    });

    it('returns the evaluated value when telemetry fails', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getBooleanValue.mockResolvedValue(true);
        mockIncrement.mockImplementation(() => {
            throw new Error('dogstatsd down');
        });
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map());
        await expect(client.isEnabled('my-flag', {}, false)).resolves.toBe(true);
        expect(mockLogger.warning).not.toHaveBeenCalled();
    });

    it('returns the default when evaluation fails and telemetry fails', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getBooleanValue.mockRejectedValue(new Error('provider down'));
        mockIncrement.mockImplementation(() => {
            throw new Error('dogstatsd down');
        });
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map());
        await expect(client.isEnabled('my-flag', {}, false)).resolves.toBe(false);
        expect(mockLogger.warning).toHaveBeenCalledWith('Feature flag evaluation failed, using default', {
            key: 'my-flag',
            err: expect.any(Error)
        });
    });

    it('returns the env override without asking the provider', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map([['audit-trail', 'true']]));
        await expect(client.isEnabled('audit-trail', { targetingKey: 'uuid1' }, false)).resolves.toBe(true);
        expect(openFeatureClient.getBooleanValue).not.toHaveBeenCalled();
        expect(mockIncrement).toHaveBeenCalledWith('nango.feature_flags.evaluated', 1, {
            flag: 'audit-trail',
            type: 'boolean',
            overridden: 'true',
            result: 'true'
        });
    });

    it('overrides string, number and object flags', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        const client = buildFeatureFlagsClient(
            new NoopProvider(),
            new Map([
                ['ui-variant', 'new-ui'],
                ['rate-limit', '42'],
                ['limits', '{"max":3}']
            ])
        );
        await expect(client.getString('ui-variant', {}, 'old-ui')).resolves.toBe('new-ui');
        await expect(client.getNumber('rate-limit', {}, 10)).resolves.toBe(42);
        await expect(client.getObject('limits', {}, { max: 1 })).resolves.toEqual({ max: 3 });
    });

    it('falls back to the provider when the override does not match the flag type', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getBooleanValue.mockResolvedValue(true);
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map([['audit-trail', 'maybe']]));
        await expect(client.isEnabled('audit-trail', {}, false)).resolves.toBe(true);
        expect(openFeatureClient.getBooleanValue).toHaveBeenCalled();
    });

    it('leaves flags without an override to the provider', async () => {
        const { buildFeatureFlagsClient } = await import('./client.js');
        const { NoopProvider } = await import('./providers/noop.js');
        openFeatureClient.getBooleanValue.mockResolvedValue(false);
        const client = buildFeatureFlagsClient(new NoopProvider(), new Map([['audit-trail', 'true']]));
        await expect(client.isEnabled('mfa', {}, true)).resolves.toBe(false);
        expect(openFeatureClient.getBooleanValue).toHaveBeenCalled();
    });
});
