// Empty stubs for Cloudflare Workers incompatible packages
// These packages are used by passkeys which are disabled for CF deployments
export default {}

// tsyringe stubs
export const container = {}
export const injectable = () => () => {}
export const inject = () => () => {}
export const singleton = () => () => {}

// @better-auth/passkey stub
export const passkey = () => ({
  id: 'passkey',
  endpoints: {},
  middlewares: [],
  hooks: {}
})

// @simplewebauthn/server stubs
export const generateRegistrationOptions = () => Promise.resolve({})
export const verifyRegistrationResponse = () => Promise.resolve({ verified: false })
export const generateAuthenticationOptions = () => Promise.resolve({})
export const verifyAuthenticationResponse = () => Promise.resolve({ verified: false })
