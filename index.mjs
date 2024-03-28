import z from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { promises } from 'bare-fs'
import { fileURLToPath } from 'bare-url'
import path from 'bare-path'

const defaultPath = '/_swag.json'
const defaultAgreementPath = '/_agreement.mjs'

export function params (_param) {
  const info = { 
    return: z.undefined(), 
    header: z.undefined(),
    headers: () => {}, // just a placeholder so type systems dont complain
    returns: () => {}, // just a placeholder so type systems dont complain
  }
  if (!_param) _param = z.undefined()
  info.param = (_param instanceof z.ZodSchema) ? _param : z.object(_param)
  info.returns = (returns) => {
    // if (returns instanceof z.ZodSchema) info.return = returns 
    // else info.return = z.object(returns)
    info.return = returns 
    return info
  }
  info.headers = (headers) => {
    (headers instanceof z.ZodSchema) ? info.header = headers : info.header = z.object(headers)
    return info
  }
  return info 
}

 function _implement (channel, agreement, impl, validator) {
  // need to validate the agreement
  const { role, version, routes } = agreement
  Object.keys(routes).forEach(name => {
    const route = routes[name]
    const implementation = impl[name]
    if (!implementation) return console.log('warning, no implementation for route', name)

    // the implementation
    const withArgs = (route.param instanceof z.ZodUndefined) ? z.function().args() : z.function().args(route.param) 
    const withReturn = (route.return instanceof z.ZodUndefined) ? withArgs : withArgs.returns(route.return)
    const func = withReturn.implement(implementation)

    const transferSchema = z.object({
      headers: (route.header) ? route.header : z.undefined(),
      params: (route.param) ? route.param : z.undefined(),
    })
  
   const transferInterceptor = z.function().args(transferSchema).implement(async ({ headers, params }) => {
      if (!headers) headers = {}
      const { remotePublicKey } = channel?.protomux?.stream
      const rpk = remotePublicKey.toString('hex')
      const extraInfo = { remotePublicKey: rpk, params }
      if (validator) {
        await validator(name, headers, extraInfo)
      }
      const returnVal = func(params)
      return returnVal
    })
    channel.method(name, transferInterceptor)
  })
}  

const ChannelSchema = z
  .custom(val => val?.constructor?.name === 'JSONRPCMuxChannel')
  .describe('a JSONRPCMuxChannel')
/** @typedef { z.infer<typeof ChannelSchema> } Channel */

const AgreementSchema = z.object({
  role: z.string().describe('the role the service provides'),
  version: z.string().regex(/^(\d+\.)?(\d+\.)?(\*|\d+)$/).describe('the version of the service, simple semver, eg 1.0.2'),
  routes: z.object({}).passthrough().describe('the routes the service provides')
})
/** @typedef { z.infer<typeof AgreementSchema> } Agreement*/

const ImportSchema = z.object({
  import: AgreementSchema,
}).passthrough().describe('the agreement to import')

const ImplSchema = z.object({}).catchall(z.function()).describe('the functions that implement each name in the interface')
const ValidatorSchema = z.function().args(
  z.string(),
  z.object({}).passthrough().describe('the headers passed in from the client'),
  z.object({
    remotePublicKey: z.string().optional().describe('the remote public key, if available, as hex string')
  }).passthrough()
).describe('a validator function to audit and gate incoming requests. Rejections will throw')
/** @typedef { z.infer<typeof ValidatorSchema> } Validator */

/**
* server implement a agreement on a channel, with an optional validator
 *
 * @param { Channel } channel - The jsonrpc-mux channel
 * @param { Agreement } agreement - The agreement interface
 * @param { Object } impl - The implementation functions of the agreement
 * @param { Validator } validator - a validator function to audit and gate incoming requests
 * @returns {null} 
 */
export const implement = z.function().args(
  ChannelSchema,
  z.union([AgreementSchema, ImportSchema]),
  ImplSchema,
  ValidatorSchema
).implement((channel, agreementOrImport, impl, validator) => {
  const agreement = (agreementOrImport.import) ? agreementOrImport.import : agreementOrImport
  return _implement(channel, agreement, impl, validator)
})

const clientWrap = (channel, name, route, setHeaders) => {
  const transferSchema = z.object({
    headers: (route.header) ? route.header : z.undefined(),
    params: (route.param) ? route.param : z.undefined(),
  })
  const transferInterceptor = z.function().args(transferSchema).implement(async (paramsAndHeaders) => {
    return channel.request(name, paramsAndHeaders)
  })

  const withArgs = (route.param instanceof z.ZodUndefined) ? z.function().args() : z.function().args(route.param) 
  const withReturn = (route.return instanceof z.ZodUndefined) ? withArgs : withArgs.returns(z.promise(route.return))
  const func = withReturn.implement(async params => {
    const payload = { }
    if (params) payload.params = params
    if (route.header instanceof z.ZodObject) payload.headers = setHeaders()
    const returnVal = transferInterceptor(payload)

    return returnVal
  })
  return func
}

function _proxy (channel, agreement, setHeaders) {
  // should validate the agreement 
  const { role, version, routes } = agreement
  const api = { _channel: channel }
  Object.keys(routes).forEach(name => {
    const func = clientWrap(channel, name, routes[name], setHeaders)
    api[name] = func
  })
  return api
}

const HeadersSchema = z.function()
  .returns(z.object({}).passthrough()).describe('key values of headers')
/** @typedef { z.infer<typeof HeadersSchema> } Headers */

/**
* client proxy a agreement on a channel, with an optional headers generator 
 *
 * @param { Channel } channel - The jsonrpc-mux channel
 * @param { Agreement } agreement - The agreement interface
 * @param { Headers } headers - The optional headers implementation function
 * @returns { Object } - the client api that will proxy to the server
 */
export const proxy = z.function().args(
  ChannelSchema,
  AgreementSchema,
  HeadersSchema
).implement(_proxy)


// swag methods

export const serialize = ({role, version, description, routes}) => {
  const _routes = Object.keys(routes).map(name => {
    const info = routes[name]
    const param = zodToJsonSchema(info.param, 'form')
    const paramSchema = param?.definitions?.form
 
    const _returns = zodToJsonSchema(info.return, 'form')
    const returnSchema = _returns?.definitions?.form
    
    const headers = zodToJsonSchema(info.header, 'form')
    const headerSchema = headers?.definitions?.form

    return { name, paramSchema, headerSchema, returnSchema } 
    
  })
  const api = { role, version, description, routes: _routes }
  return api 
}

export const fullPath = (relativePath, moduleUrl) => {
  const __filename = fileURLToPath(moduleUrl)
  const __dirname = path.dirname(__filename)
  const location = path.resolve(__dirname, relativePath)
  return location
}

export const load = async (location) => {
  // todo - location could be an http or other protocol. we could load it from these other sources!
  let loadedAgreement = location
  let mjs = null
  if (typeof location === 'string') {
    try {
      const { default: agreement } = await import(location)
      loadedAgreement = agreement
      // open the file and get the contents 
      mjs = await promises.readFile(location, 'utf-8')
    } catch (e) {
      console.log('could not load agreement', e)
    }
  }
  const api = serialize(loadedAgreement)
  return { import: loadedAgreement, api, mjs }
}

export const loadAgreement = async (location, moduleUrl) => {
  const _path = fullPath(location, moduleUrl)
  return await load(_path)
}

export const addMetaRoutes = (channel, { api, mjs }, jsonPath, agreementPath) => {
  if (!jsonPath) jsonPath = defaultPath
  channel.method(jsonPath, () => api)
  if (mjs) {
    if (!agreementPath) agreementPath = defaultAgreementPath
    channel.method(agreementPath, () => mjs) 
  }
}

// really the main export the most should be using
export const enact = (framed, agreement, impl, validator) => {
  implement(framed, agreement, impl, validator)
  addMetaRoutes(framed, agreement)
}
