/**
 * Select only an explicit mobile build variant in its matching server realm.
 * @param {string[]} args
 * @param {string | undefined} environment
 * @returns {import('../../../packages/customer-contracts/src/mobile').MobileVariant}
 */
export function selectReadinessVariant(args, environment) {
  if (!['staging', 'production'].includes(environment ?? '')) throw Error('invalid_mobile_environment');
  if (args.length && (args.length !== 2 || args[0] !== '--variant')) throw Error('invalid_mobile_variant_arguments');
  const value = args[1] ?? (environment === 'production' ? 'production' : 'development');
  if (!['development', 'preview', 'production'].includes(value) ||
      (environment === 'production' ? value !== 'production' : value === 'production'))
    throw Error('invalid_mobile_variant');
  return /** @type {import('../../../packages/customer-contracts/src/mobile').MobileVariant} */ (value);
}
