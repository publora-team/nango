import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFlagOverrides, readFlagOverride } from './overrides.js';

const mockLogger = vi.hoisted(() => ({
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
}));

const mockEnvs = vi.hoisted(() => ({ NANGO_CLOUD: false }));

vi.mock('@nangohq/utils', () => ({
    getLogger: vi.fn(() => mockLogger)
}));

vi.mock('./env.js', () => ({
    envs: mockEnvs
}));

describe('getFlagOverrides', () => {
    const realEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = {};
    });

    afterEach(() => {
        process.env = realEnv;
        mockEnvs.NANGO_CLOUD = false;
    });

    it('maps prefixed env vars to flag keys', () => {
        process.env['NANGO_FEATURE_FLAG_AUDIT_TRAIL'] = 'true';
        process.env['NANGO_FEATURE_FLAG_MFA'] = 'false';
        expect(getFlagOverrides()).toEqual(
            new Map([
                ['audit-trail', 'true'],
                ['mfa', 'false']
            ])
        );
    });

    it('ignores env vars without the prefix', () => {
        process.env['NANGO_FLAG_PROVIDER'] = 'unleash';
        process.env['NANGO_UNLEASH_URL'] = 'http://localhost:4242';
        process.env['AUDIT_TRAIL'] = 'true';
        expect(getFlagOverrides().size).toBe(0);
    });

    it('ignores the bare prefix', () => {
        process.env['NANGO_FEATURE_FLAG_'] = 'true';
        expect(getFlagOverrides().size).toBe(0);
    });

    it('ignores overrides on cloud', () => {
        process.env['NANGO_FEATURE_FLAG_AUDIT_TRAIL'] = 'true';
        mockEnvs.NANGO_CLOUD = true;
        expect(getFlagOverrides().size).toBe(0);
    });
});

describe('readFlagOverride', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns undefined when the flag has no override', () => {
        expect(readFlagOverride('mfa', 'boolean', new Map([['audit-trail', 'true']]))).toBeUndefined();
    });

    it.each([
        ['true', true],
        ['TRUE', true],
        [' true ', true],
        ['false', false],
        ['False', false]
    ])('reads %s as the boolean %s', (raw, expected) => {
        expect(readFlagOverride('audit-trail', 'boolean', new Map([['audit-trail', raw]]))).toBe(expected);
    });

    it.each(['1', '0', 'yes', 'no', 'on', 'off', 'maybe', ''])('ignores %s as a boolean', (raw) => {
        expect(readFlagOverride('audit-trail', 'boolean', new Map([['audit-trail', raw]]))).toBeUndefined();
    });

    it('warns when a boolean override is not a boolean', () => {
        readFlagOverride('audit-trail', 'boolean', new Map([['audit-trail', 'maybe']]));
        expect(mockLogger.warning).toHaveBeenCalledWith('Ignoring feature flag override, value does not match the flag type', {
            key: 'audit-trail',
            type: 'boolean',
            value: 'maybe'
        });
    });

    it('reads numbers', () => {
        expect(readFlagOverride('rate-limit', 'number', new Map([['rate-limit', ' 42 ']]))).toBe(42);
    });

    it.each(['', 'abc', 'Infinity'])('ignores %s as a number', (raw) => {
        expect(readFlagOverride('rate-limit', 'number', new Map([['rate-limit', raw]]))).toBeUndefined();
    });

    it('reads strings verbatim', () => {
        expect(readFlagOverride('ui-variant', 'string', new Map([['ui-variant', ' new ui ']]))).toBe(' new ui ');
    });

    it('reads objects as JSON', () => {
        expect(readFlagOverride('limits', 'object', new Map([['limits', '{"max":3}']]))).toEqual({ max: 3 });
    });

    it('ignores an object override that is not valid JSON', () => {
        expect(readFlagOverride('limits', 'object', new Map([['limits', '{max:3}']]))).toBeUndefined();
        expect(mockLogger.warning).toHaveBeenCalled();
    });
});
